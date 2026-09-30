@_spi(ExperimentalTargetElement) import ReadiumNavigator
import AVFoundation
import ReadiumShared
import UIKit

@MainActor
final class WovenleafReaderViewController: UIViewController, EPUBNavigatorDelegate {
    var fileAccess: OriginalFileAccess?
    private static let readerRightPadding: CGFloat = 8

    private let publication: Publication
    private let navigator: EPUBNavigatorViewController
    private let initialLocator: Locator?
    private let context: ReaderContext
    private var globalPreferences: WovenleafReaderPreferences
    private var bookPreferences: WovenleafReaderPreferences?
    private let sessionId = "reading-session:reader:\(UUID().uuidString.lowercased())"
    private var activeClock = ReaderActiveClock()
    private var activeTimer: Timer?
    private var readerVisible = false
    private var sessionClosed = false
    private var checkpointTimer: Timer?
    private var preferenceTimer: Timer?
    private var pendingPreference: (ReaderPreferenceScope, WovenleafReaderPreferences?)?
    private var lastLocator: Locator?
    private var navigationState: ReaderNavigationState
    private var annotationState: ReaderAnnotationCollection
    private var navigationHistory: [Locator] = []
    private var pendingJumpOrigin: Locator?
    private var restoringHistory = false
    private var inputObserverTokens: Set<InputObservableToken> = []
    private let speechSynthesizer = AVSpeechSynthesizer()
    private var presentedCompatibilityNotice = false
    private let progressControl = ReaderProgressControl()
    private let topChrome = UIView()
    private let bottomChrome = UIView()
    private let titleLabel = UILabel()
    private lazy var libraryButton = ReaderChromeButton(title: WovenleafL10n.text("Library"), target: self, action: #selector(closeReader))
    private lazy var appearanceButton = ReaderChromeButton(symbol: "textformat.size", target: self, action: #selector(showReaderSettings))
    private lazy var bookmarkButton = ReaderChromeButton(symbol: "bookmark", target: self, action: #selector(toggleBookmark))
    private lazy var outlineButton = ReaderChromeButton(symbol: "line.3.horizontal.decrease", target: self, action: #selector(showReaderOutline))
    private lazy var previousButton = ReaderChromeButton(
        symbol: context.compatibility?.isRightToLeft == true ? "chevron.right" : "chevron.left",
        target: self,
        action: #selector(previousPage)
    )
    private lazy var nextButton = ReaderChromeButton(
        symbol: context.compatibility?.isRightToLeft == true ? "chevron.left" : "chevron.right",
        target: self,
        action: #selector(nextPage)
    )
    private lazy var compatibilityButton = ReaderChromeButton(symbol: "info.circle", target: self, action: #selector(showCompatibilityNotice))
    private let textureView = PaperTextureView()
    private let chapterRail = ReaderChapterRailView()
    private let feedbackView = ReaderFeedbackView()
    private var lastChapterHref: String?
    private var didShowFinishFeedback = false
    private var pageTurnInFlight = false
    private var queuedPageTurns: [ReaderPageTurnDirection] = []
    private var isAtStart = false
    private var isAtEnd = false

    init(
        publication: Publication,
        initialLocator: Locator?,
        context: ReaderContext,
        globalPreferences: WovenleafReaderPreferences,
        bookPreferences: WovenleafReaderPreferences?
    ) throws {
        self.publication = publication
        self.context = context
        self.initialLocator = initialLocator
        self.globalPreferences = globalPreferences
        self.bookPreferences = bookPreferences
        navigationState = context.navigationState
        annotationState = context.annotationState
        let preferences = context.compatibility?.renderingPreferences(bookPreferences ?? globalPreferences)
            ?? bookPreferences
            ?? globalPreferences
        self.navigator = try EPUBNavigatorViewController(
            publication: publication,
            initialLocation: initialLocator,
            config: .init(
                preferences: preferences.readiumPreferences(
                    compactWidth: true,
                    highContrast: UIAccessibility.isDarkerSystemColorsEnabled
                ),
                editingActions: EditingAction.defaultActions + [
                    EditingAction(title: WovenleafL10n.text("Highlight"), action: #selector(createHighlight(_:))),
                    EditingAction(title: WovenleafL10n.text("Add Note"), action: #selector(createPassageNote(_:))),
                    EditingAction(title: WovenleafL10n.text("Read Aloud"), action: #selector(readSelectionAloud(_:))),
                ]
            )
        )
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError(WovenleafL10n.text("init(coder:) has not been implemented")) }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationController?.setNavigationBarHidden(true, animated: false)
        navigationController?.setToolbarHidden(true, animated: false)
        view.backgroundColor = readerPalette.page

        libraryButton.accessibilityLabel = WovenleafL10n.text("Close reader and return to library")
        appearanceButton.accessibilityLabel = WovenleafL10n.text("Reading appearance")
        bookmarkButton.accessibilityLabel = WovenleafL10n.text("Add bookmark")
        outlineButton.accessibilityLabel = WovenleafL10n.text("Browse chapters, bookmarks, notes, and search")
        previousButton.accessibilityLabel = WovenleafL10n.text("Previous page")
        nextButton.accessibilityLabel = WovenleafL10n.text("Next page")
        compatibilityButton.accessibilityLabel = WovenleafL10n.text("Reading compatibility")
        compatibilityButton.isHidden = context.compatibility?.notices.isEmpty != false

        buildReaderChrome()

        addChild(navigator)
        navigator.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(navigator.view)
        NSLayoutConstraint.activate([
            navigator.view.leadingAnchor.constraint(
                equalTo: view.leadingAnchor,
                constant: ReaderChapterRailView.gutterWidth
            ),
            navigator.view.trailingAnchor.constraint(
                equalTo: view.trailingAnchor,
                constant: -Self.readerRightPadding
            ),
            navigator.view.topAnchor.constraint(equalTo: topChrome.bottomAnchor),
            navigator.view.bottomAnchor.constraint(equalTo: bottomChrome.topAnchor),
        ])
        navigator.didMove(toParent: self)

        textureView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(textureView)
        NSLayoutConstraint.activate([
            textureView.leadingAnchor.constraint(equalTo: navigator.view.leadingAnchor),
            textureView.trailingAnchor.constraint(equalTo: navigator.view.trailingAnchor),
            textureView.topAnchor.constraint(equalTo: navigator.view.topAnchor),
            textureView.bottomAnchor.constraint(equalTo: navigator.view.bottomAnchor),
        ])

        chapterRail.translatesAutoresizingMaskIntoConstraints = false
        chapterRail.onNavigate = { [weak self] link in self?.navigate(to: link, fromToc: true) }
        view.addSubview(chapterRail)
        NSLayoutConstraint.activate([
            chapterRail.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            chapterRail.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            chapterRail.topAnchor.constraint(equalTo: navigator.view.topAnchor),
            chapterRail.bottomAnchor.constraint(equalTo: navigator.view.bottomAnchor),
        ])

        feedbackView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(feedbackView)
        NSLayoutConstraint.activate([
            feedbackView.centerXAnchor.constraint(equalTo: navigator.view.centerXAnchor),
            feedbackView.bottomAnchor.constraint(equalTo: navigator.view.bottomAnchor, constant: -18),
            feedbackView.widthAnchor.constraint(lessThanOrEqualTo: navigator.view.widthAnchor, constant: -72),
        ])

        progressControl.onCommit = { [weak self] progression in
            self?.scrub(to: progression)
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(flushForLifecycle),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(resumeActiveReading),
            name: UIApplication.didBecomeActiveNotification, object: nil
        )
        applyReaderPalette()
        updateBookmarkButton()
        setupReaderInput()
        loadChapterRail()
        setupAnnotationInteractions()
        applyAnnotationDecorations()
        attemptAnnotationReanchoring()
        ReaderOutbox.enqueue(kind: "start", context: context, sessionId: sessionId, locator: initialLocator)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        readerVisible = true
        resumeActiveReading()
        if !presentedCompatibilityNotice, context.compatibility?.notices.isEmpty == false {
            presentedCompatibilityNotice = true
            showCompatibilityNotice()
        } else {
            UIAccessibility.post(notification: .screenChanged, argument: navigator.view)
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        readerVisible = false
        flushActiveReading(reason: "pause")
        super.viewWillDisappear(animated)
    }

    @objc private func resumeActiveReading() {
        guard readerVisible, !sessionClosed, UIApplication.shared.applicationState == .active else { return }
        activeClock.resume(wallMs: Int64(Date().timeIntervalSince1970 * 1_000),
                           monotonicMs: Int64(ProcessInfo.processInfo.systemUptime * 1_000))
        guard activeTimer == nil else { return }
        let timer = Timer(timeInterval: ReaderActiveClock.checkpointSeconds, repeats: true) { [weak self] _ in
            self?.flushActiveReading(reason: "checkpoint")
        }
        RunLoop.main.add(timer, forMode: .common)
        activeTimer = timer
    }

    private func flushActiveReading(reason: String) {
        if reason != "checkpoint" {
            activeTimer?.invalidate()
            activeTimer = nil
        }
        guard let interval = activeClock.flush(
            wallMs: Int64(Date().timeIntervalSince1970 * 1_000),
            monotonicMs: Int64(ProcessInfo.processInfo.systemUptime * 1_000), reason: reason
        ) else { return }
        ReaderOutbox.enqueue(
            kind: "session", context: context,
            sessionId: "\(sessionId):\(interval.index)", locator: lastLocator ?? navigator.currentLocation,
            startedAt: ReaderOutbox.timestamp(Date(timeIntervalSince1970: Double(interval.startedAtMs) / 1_000)),
            endedAt: ReaderOutbox.timestamp(Date(timeIntervalSince1970: Double(interval.endedAtMs) / 1_000)),
            activeDurationMs: Int(interval.endedAtMs - interval.startedAtMs),
            extra: ["reachedEnd": isAtEnd, "activeCapture": [
                "version": 1, "kind": "epub-foreground", "captureId": sessionId,
                "intervalIndex": interval.index, "startReason": interval.startReason, "endReason": interval.endReason,
            ]]
        )
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        effectivePreferences.theme == .graphite ? .lightContent : .darkContent
    }

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        let previousKey = context.compatibility?.isRightToLeft == true
            ? UIKeyCommand.inputRightArrow
            : UIKeyCommand.inputLeftArrow
        let nextKey = context.compatibility?.isRightToLeft == true
            ? UIKeyCommand.inputLeftArrow
            : UIKeyCommand.inputRightArrow
        return [
            UIKeyCommand(input: previousKey, modifierFlags: [], action: #selector(previousPage)),
            UIKeyCommand(input: nextKey, modifierFlags: [], action: #selector(nextPage)),
            UIKeyCommand(input: "f", modifierFlags: .command, action: #selector(showReaderOutline)),
            UIKeyCommand(input: "b", modifierFlags: .command, action: #selector(toggleBookmark)),
            UIKeyCommand(input: "h", modifierFlags: [.command, .shift], action: #selector(createHighlight(_:))),
            UIKeyCommand(input: "n", modifierFlags: [.command, .shift], action: #selector(createPassageNote(_:))),
            UIKeyCommand(input: "s", modifierFlags: [.command, .shift], action: #selector(readSelectionAloud(_:))),
            UIKeyCommand(input: "[", modifierFlags: .command, action: #selector(goBackInBook)),
            UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(handleEscape)),
        ]
    }

    // Window bounds, reader typography, and Dynamic Type determine whether each
    // page has room. Size classes alone stay regular in some narrow iPad windows.
    private var usesCompactReadingWidth: Bool {
        let textScale = max(1, effectivePreferences.fontSize)
        let interfaceScale = max(1, Double(UIFontMetrics.default.scaledValue(for: 17) / 17))
        return Double(view.bounds.inset(by: view.safeAreaInsets).width) < 960 * textScale * interfaceScale
    }

    private var lastCompactReadingWidth: Bool?

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let compact = usesCompactReadingWidth
        if lastCompactReadingWidth != compact {
            lastCompactReadingWidth = compact
            applyPreferences()
        }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.applyPreferences()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        activeTimer?.invalidate()
        checkpointTimer?.invalidate()
        preferenceTimer?.invalidate()
        publication.close()
    }

    private func buildReaderChrome() {
        [topChrome, bottomChrome].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }

        titleLabel.text = context.title
        titleLabel.font = .preferredFont(forTextStyle: .subheadline)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.minimumScaleFactor = 0.72
        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.accessibilityTraits = .header

        let trailing = UIStackView(arrangedSubviews: [bookmarkButton, compatibilityButton, appearanceButton])
        trailing.axis = .horizontal
        trailing.alignment = .center
        trailing.spacing = 2

        let topStack = UIStackView(arrangedSubviews: [libraryButton, titleLabel, trailing])
        topStack.translatesAutoresizingMaskIntoConstraints = false
        topStack.axis = .horizontal
        topStack.alignment = .center
        topStack.spacing = 8
        topChrome.addSubview(topStack)

        libraryButton.setContentHuggingPriority(.required, for: .horizontal)
        trailing.setContentHuggingPriority(.required, for: .horizontal)
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let bottomStack = UIStackView(arrangedSubviews: [outlineButton, UIView(), progressControl, UIView(), previousButton, nextButton])
        bottomStack.translatesAutoresizingMaskIntoConstraints = false
        bottomStack.axis = .horizontal
        bottomStack.alignment = .center
        bottomStack.spacing = 4
        bottomChrome.addSubview(bottomStack)

        NSLayoutConstraint.activate([
            topChrome.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topChrome.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            topChrome.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            topChrome.heightAnchor.constraint(equalToConstant: 54),
            bottomChrome.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bottomChrome.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottomChrome.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            bottomChrome.heightAnchor.constraint(equalToConstant: 62),
            topStack.leadingAnchor.constraint(equalTo: topChrome.leadingAnchor, constant: 10),
            topStack.trailingAnchor.constraint(equalTo: topChrome.trailingAnchor, constant: -10),
            topStack.topAnchor.constraint(equalTo: topChrome.topAnchor, constant: 5),
            topStack.bottomAnchor.constraint(equalTo: topChrome.bottomAnchor, constant: -5),
            bottomStack.leadingAnchor.constraint(equalTo: bottomChrome.leadingAnchor, constant: 10),
            bottomStack.trailingAnchor.constraint(equalTo: bottomChrome.trailingAnchor, constant: -10),
            bottomStack.topAnchor.constraint(equalTo: bottomChrome.topAnchor, constant: 5),
            bottomStack.bottomAnchor.constraint(equalTo: bottomChrome.bottomAnchor, constant: -5),
        ])
    }

    private func loadChapterRail() {
        Task { [weak self] in
            guard let self else { return }
            let links = (try? await publication.tableOfContents().get()) ?? []
            chapterRail.setLinks(links)
            if navigationState.toc?.assetFingerprint == context.assetFingerprint {
                chapterRail.updateActive(locator: navigationState.toc?.locator)
            }
            chapterRail.updateActive(locator: lastLocator ?? navigator.currentLocation)
        }
    }

    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        let previousChapter = lastChapterHref
        lastLocator = locator
        updateReadingBounds(self.navigator.viewport)
        updateProgress(locator)
        updateBookmarkButton()
        chapterRail.updateActive(locator: locator)
        lastChapterHref = locator.href.string
        if let previousChapter, previousChapter != locator.href.string {
            chapterRail.revealActiveMomentarily()
            feedbackView.show(locator.title ?? WovenleafL10n.text("New chapter"), symbol: "text.book.closed")
        }
        checkpointTimer?.invalidate()
        checkpointTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.flushLocation() }
        }
    }

    func navigator(_ navigator: Navigator, didJumpTo locator: Locator) {
        if restoringHistory {
            restoringHistory = false
            pendingJumpOrigin = nil
            return
        }
        if let origin = pendingJumpOrigin, !samePassage(origin, locator) {
            navigationHistory.append(origin)
        }
        pendingJumpOrigin = nil
    }

    func navigator(_ navigator: VisualNavigator, shouldNavigateToLink link: Link) -> Bool {
        pendingJumpOrigin = lastLocator ?? self.navigator.currentLocation
        return true
    }

    func navigator(
        _ navigator: Navigator,
        shouldNavigateToNoteAt link: Link,
        content: String,
        referrer: String?
    ) -> Bool {
        let note = ReaderFootnoteViewController(content: content, palette: readerPalette)
        let navigation = UINavigationController(rootViewController: note)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
        return false
    }

    func navigator(_ navigator: Navigator, presentExternalURL url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            presentReaderMessage(
                title: WovenleafL10n.text("Link blocked"),
                message: WovenleafL10n.text("Wovenleaf only hands web links to your browser. This link uses an unsupported address type.")
            )
            return
        }
        let destination = url.host ?? WovenleafL10n.text("your browser")
        let alert = UIAlertController(
            title: WovenleafL10n.text("Leave Wovenleaf?"),
            message: WovenleafL10n.text("Open {{destination}} in your default browser? The book file and Wovenleaf’s private storage are not shared.", ["destination": destination]),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Cancel"), style: .cancel))
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Open in Browser"), style: .default) { _ in
            UIApplication.shared.open(url, options: [:])
        })
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    func navigator(_ navigator: Navigator, presentError error: NavigatorError) {
        let alert = UIAlertController(
            title: WovenleafL10n.text("Page unavailable"),
            message: WovenleafL10n.text("Wovenleaf kept your last trusted reading position."),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("OK"), style: .default))
        present(alert, animated: true)
    }

    func navigator(_ navigator: Navigator, didFailToLoadResourceAt href: RelativeURL, withError error: ReadError) {
        flushLocation()
    }

    @objc private func previousPage() {
        requestPageTurn(.previous)
    }

    @objc private func nextPage() {
        requestPageTurn(.next)
    }

    @objc private func showReaderOutline() {
        let outline = ReaderOutlineViewController(
            publication: publication,
            currentLocator: lastLocator ?? navigator.currentLocation,
            selectedTocLocator: navigationState.toc?.locator,
            bookmarks: navigationState.bookmarks,
            annotations: annotationState.annotations,
            palette: readerPalette
        )
        outline.onNavigateToLink = { [weak self] link in self?.navigate(to: link, fromToc: true) }
        outline.onNavigateToLocator = { [weak self] locator in self?.navigate(to: locator) }
        outline.onDeleteBookmark = { [weak self] bookmark in self?.deleteBookmark(bookmark) }
        outline.onEditAnnotation = { [weak self] annotation in self?.editAnnotation(annotation) }
        outline.onDeleteAnnotation = { [weak self] annotation in self?.deleteAnnotation(annotation) }
        outline.onReviewAnnotation = { [weak self] annotation in self?.reviewAnnotation(annotation) }
        let navigation = UINavigationController(rootViewController: outline)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 18
        }
        present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    @objc private func goBackInBook() {
        guard let locator = navigationHistory.popLast() else { return }
        restoringHistory = true
        Task {
            if !(await navigator.go(to: locator, options: .animated)) {
                restoringHistory = false
                navigationHistory.append(locator)
            }
        }
    }

    @objc private func toggleBookmark() {
        guard let locator = lastLocator ?? navigator.currentLocation else { return }
        if let existing = navigationState.bookmarks.first(where: { samePassage($0.locator, locator) }) {
            deleteBookmark(existing)
            UIAccessibility.post(notification: .announcement, argument: WovenleafL10n.text("Bookmark removed"))
            feedbackView.show(WovenleafL10n.text("Bookmark removed"), symbol: "bookmark.slash")
            return
        }
        let timestamp = ReaderOutbox.timestamp()
        let bookmark = ReaderBookmarkState(
            id: "reader-bookmark:\(UUID().uuidString.lowercased())",
            assetId: context.assetId,
            assetFingerprint: context.assetFingerprint,
            locator: locator,
            createdAt: timestamp,
            updatedAt: timestamp
        )
        navigationState.bookmarks.append(bookmark)
        navigationState.updatedAt = timestamp
        ReaderOutbox.enqueueBookmark(
            context: context,
            sessionId: sessionId,
            action: "upsert",
            bookmarkId: bookmark.id,
            locator: locator,
            createdAt: timestamp
        )
        updateBookmarkButton()
        UIAccessibility.post(notification: .announcement, argument: WovenleafL10n.text("Bookmark added"))
        feedbackView.show(WovenleafL10n.text("Page kept"), symbol: "bookmark.fill")
        bookmarkButton.pulse()
    }

    @objc private func handleEscape() {
        if presentedViewController != nil {
            dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
        } else {
            closeReader()
        }
    }

    @objc private func showReaderSettings() {
        let settings = ReaderSettingsViewController(
            globalPreferences: globalPreferences,
            bookPreferences: bookPreferences,
            compactWidth: usesCompactReadingWidth
        )
        settings.onSave = { [weak self] scope, preferences in
            self?.savePreferences(scope: scope, preferences: preferences)
        }
        let navigation = UINavigationController(rootViewController: settings)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 18
        }
        present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    @objc private func flushForLifecycle() {
        flushActiveReading(reason: "pause")
        flushPreference()
        flushLocation()
    }

    @objc private func closeReader() {
        finishReading(animated: true)
    }

    func closeForIncomingFile(completion: @escaping () -> Void) {
        finishReading(animated: false, completion: completion)
    }

    private func finishReading(animated: Bool, completion: (() -> Void)? = nil) {
        guard !sessionClosed else { completion?(); return }
        sessionClosed = true
        flushActiveReading(reason: "close")
        checkpointTimer?.invalidate()
        for token in inputObserverTokens {
            navigator.removeObserver(token)
        }
        inputObserverTokens.removeAll()
        speechSynthesizer.stopSpeaking(at: .immediate)
        flushPreference()
        flushLocation()
        navigationController?.dismiss(animated: animated, completion: completion)
    }

    private func flushLocation() {
        checkpointTimer?.invalidate()
        checkpointTimer = nil
        guard let locator = lastLocator ?? navigator.currentLocation else { return }
        ReaderOutbox.enqueue(
            kind: "location", context: context, sessionId: sessionId, locator: locator,
            extra: ["reachedEnd": isAtEnd]
        )
    }

    private func updateProgress(_ locator: Locator) {
        if let progression = isAtEnd ? 1 : locator.locations.totalProgression {
            let percent = isAtEnd ? 100 : min(99, Int((progression * 100).rounded()))
            progressControl.setProgress(progression, label: "\(percent)%")
        } else {
            progressControl.setLabel(locator.title ?? WovenleafL10n.text("Reading"))
        }
    }

    private func navigate(to link: Link, fromToc: Bool = false) {
        pendingJumpOrigin = lastLocator ?? navigator.currentLocation
        Task {
            guard await navigator.go(to: link, options: .animated) else {
                pendingJumpOrigin = nil
                presentReaderMessage(title: WovenleafL10n.text("Section unavailable"), message: WovenleafL10n.text("This book’s navigation entry is broken or missing."))
                return
            }
            if fromToc, let locator = await publication.locate(link) {
                navigationState.toc = .init(
                    assetFingerprint: context.assetFingerprint,
                    locator: locator
                )
                navigationState.updatedAt = ReaderOutbox.timestamp()
                ReaderOutbox.enqueueToc(context: context, sessionId: sessionId, locator: locator)
            }
        }
    }

    private func navigate(to locator: Locator) {
        pendingJumpOrigin = lastLocator ?? navigator.currentLocation
        Task {
            if !(await navigator.go(to: locator, options: .animated)) {
                pendingJumpOrigin = nil
                presentReaderMessage(title: WovenleafL10n.text("Passage unavailable"), message: WovenleafL10n.text("Wovenleaf could not recover this passage in the current edition."))
            }
        }
    }

    private func scrub(to progression: Double) {
        Task {
            guard let locator = await publication.locate(progression: progression) else {
                presentReaderMessage(
                    title: WovenleafL10n.text("Position unavailable"),
                    message: WovenleafL10n.text("This book does not provide enough navigation data for precise scrubbing.")
                )
                return
            }
            navigate(to: locator)
        }
    }

    private func deleteBookmark(_ bookmark: ReaderBookmarkState) {
        navigationState.bookmarks.removeAll { $0.id == bookmark.id }
        navigationState.updatedAt = ReaderOutbox.timestamp()
        ReaderOutbox.enqueueBookmark(
            context: context,
            sessionId: sessionId,
            action: "delete",
            bookmarkId: bookmark.id
        )
        updateBookmarkButton()
    }

    @objc private func createHighlight(_ sender: Any?) {
        createAnnotationFromSelection()
    }

    @objc private func createPassageNote(_ sender: Any?) {
        createAnnotationFromSelection()
    }

    @objc private func readSelectionAloud(_ sender: Any?) {
        guard let quote = navigator.currentSelection?.locator.text.highlight?
            .trimmingCharacters(in: .whitespacesAndNewlines), !quote.isEmpty
        else {
            presentReaderMessage(
                title: WovenleafL10n.text("Select a passage"),
                message: WovenleafL10n.text("Select a passage first, then choose Read Aloud.")
            )
            return
        }
        speechSynthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: quote)
        if let language = context.compatibility?.primaryLanguage {
            utterance.voice = AVSpeechSynthesisVoice(language: language)
        }
        speechSynthesizer.speak(utterance)
        navigator.clearSelection()
        UIAccessibility.post(notification: .announcement, argument: WovenleafL10n.text("Reading selected passage aloud"))
    }

    @objc private func showCompatibilityNotice() {
        guard let profile = context.compatibility, !profile.notices.isEmpty else { return }
        let alert = UIAlertController(
            title: WovenleafL10n.text("Reading this edition"),
            message: profile.notices.joined(separator: "\n\n"),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Continue"), style: .default) { [weak self] _ in
            guard let self else { return }
            UIAccessibility.post(notification: .screenChanged, argument: self.navigator.view)
        })
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    private func createAnnotationFromSelection() {
        guard let selection = navigator.currentSelection else {
            presentReaderMessage(title: WovenleafL10n.text("Select a passage"), message: WovenleafL10n.text("Select a short passage first, then choose Highlight or Add Note."))
            return
        }
        let quote = selection.locator.text.highlight?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !quote.isEmpty, quote.count <= 10_000 else {
            navigator.clearSelection()
            presentReaderMessage(
                title: WovenleafL10n.text("Selection unavailable"),
                message: WovenleafL10n.text("Choose a passage between 1 and 10,000 characters. Wovenleaf does not save whole chapters as annotations.")
            )
            return
        }
        presentAnnotationEditor(locator: selection.locator, annotation: nil)
    }

    private func editAnnotation(_ annotation: ReaderAnnotationRecord) {
        presentAnnotationEditor(locator: annotation.locator, annotation: annotation)
    }

    private func reviewAnnotation(_ annotation: ReaderAnnotationRecord) {
        Task { [weak self] in
            guard let self else { return }
            let candidates = await matchingReanchorCandidates(for: annotation)
            guard !candidates.isEmpty else {
                presentReaderMessage(
                    title: WovenleafL10n.text("Passage unavailable"),
                    message: WovenleafL10n.text("This revised EPUB no longer contains the quoted passage. The annotation remains in Needs Review.")
                )
                return
            }
            if candidates.count == 1 {
                openReviewCandidate(candidates[0], annotation: annotation)
                return
            }
            let chooser = UIAlertController(
                title: WovenleafL10n.text("Choose the matching passage"),
                message: WovenleafL10n.text("The quote appears more than once. Compare its chapter and surrounding words before confirming."),
                preferredStyle: .alert
            )
            for candidate in candidates.prefix(12) {
                chooser.addAction(UIAlertAction(title: reviewCandidateLabel(candidate), style: .default) { [weak self] _ in
                    self?.openReviewCandidate(candidate, annotation: annotation)
                })
            }
            chooser.addAction(UIAlertAction(title: WovenleafL10n.text("Cancel"), style: .cancel))
            present(chooser, animated: !UIAccessibility.isReduceMotionEnabled)
        }
    }

    private func openReviewCandidate(_ locator: Locator, annotation: ReaderAnnotationRecord) {
        Task {
            guard await navigator.go(to: locator, options: .animated) else {
                presentReaderMessage(title: WovenleafL10n.text("Passage unavailable"), message: WovenleafL10n.text("This matching range could not be opened."))
                return
            }
            presentAnnotationEditor(locator: locator, annotation: annotation, needsReview: true)
        }
    }

    private func reviewCandidateLabel(_ locator: Locator) -> String {
        let context = [locator.text.before, locator.text.highlight, locator.text.after]
            .compactMap { $0 }
            .joined(separator: " ")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return "\(locator.title ?? "Passage") — \(String(context.prefix(90)))"
    }

    private func presentAnnotationEditor(
        locator: Locator,
        annotation: ReaderAnnotationRecord?,
        needsReview: Bool = false
    ) {
        let quote = annotation?.quote
            ?? locator.text.highlight?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? ""
        let editor = ReaderAnnotationEditorViewController(
            quote: quote,
            annotation: annotation,
            palette: readerPalette,
            needsReview: needsReview
        )
        editor.onSave = { [weak self] color, note, tags in
            self?.saveAnnotation(
                annotation,
                locator: locator,
                color: color,
                note: note,
                tags: tags,
                confirmingRevision: needsReview
            )
        }
        if let annotation {
            editor.onDelete = { [weak self] in self?.deleteAnnotation(annotation) }
        }
        let navigation = UINavigationController(rootViewController: editor)
        navigation.modalPresentationStyle = .pageSheet
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 18
        }
        present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    private func saveAnnotation(
        _ existing: ReaderAnnotationRecord?,
        locator: Locator,
        color: ReaderAnnotationColor,
        note: String,
        tags: [String],
        confirmingRevision: Bool
    ) {
        let timestamp = ReaderOutbox.timestamp()
        var annotation: ReaderAnnotationRecord
        if var current = existing {
            current.color = color
            current.note = note
            current.tags = tags
            current.updatedAt = timestamp
            current.deletedAt = nil
            if confirmingRevision {
                current.locator = locator
                current.editionId = context.editionId
                current.assetId = context.assetId
                current.assetFingerprint = context.assetFingerprint
                current.anchorStatus = .reanchored
                current.anchorReason = nil
            }
            annotation = current
        } else {
            annotation = ReaderAnnotationRecord(
                id: "reader-annotation:\(UUID().uuidString.lowercased())",
                context: context,
                locator: locator,
                color: color,
                note: note,
                tags: tags,
                timestamp: timestamp
            )
        }
        annotationState.annotations.removeAll { $0.id == annotation.id }
        annotationState.annotations.append(annotation)
        annotationState.annotations.sort { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
        annotationState.updatedAt = timestamp
        ReaderOutbox.enqueueAnnotation(
            context: context,
            sessionId: sessionId,
            action: "upsert",
            annotationId: annotation.id,
            annotation: annotation
        )
        navigator.clearSelection()
        applyAnnotationDecorations()
        UIAccessibility.post(notification: .announcement, argument: existing == nil ? WovenleafL10n.text("Highlight saved") : WovenleafL10n.text("Annotation updated"))
        feedbackView.show(existing == nil ? WovenleafL10n.text("Passage marked") : WovenleafL10n.text("Note updated"), symbol: "pencil.line")
    }

    private func deleteAnnotation(_ annotation: ReaderAnnotationRecord) {
        guard let index = annotationState.annotations.firstIndex(where: { $0.id == annotation.id }) else { return }
        let timestamp = ReaderOutbox.timestamp()
        annotationState.annotations[index].deletedAt = timestamp
        annotationState.annotations[index].updatedAt = timestamp
        annotationState.updatedAt = timestamp
        ReaderOutbox.enqueueAnnotation(
            context: context,
            sessionId: sessionId,
            action: "delete",
            annotationId: annotation.id
        )
        applyAnnotationDecorations()
        let alert = UIAlertController(
            title: WovenleafL10n.text("Annotation deleted"),
            message: WovenleafL10n.text("The deletion is retained for sync and portable export. You can undo it now."),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Done"), style: .cancel))
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Undo"), style: .default) { [weak self] _ in
            self?.restoreAnnotation(id: annotation.id)
        })
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    private func restoreAnnotation(id: String) {
        guard let index = annotationState.annotations.firstIndex(where: { $0.id == id }) else { return }
        annotationState.annotations[index].deletedAt = nil
        annotationState.annotations[index].updatedAt = ReaderOutbox.timestamp()
        annotationState.updatedAt = annotationState.annotations[index].updatedAt
        ReaderOutbox.enqueueAnnotation(
            context: context,
            sessionId: sessionId,
            action: "restore",
            annotationId: id
        )
        applyAnnotationDecorations()
        UIAccessibility.post(notification: .announcement, argument: WovenleafL10n.text("Annotation restored"))
    }

    private func setupAnnotationInteractions() {
        navigator.observeDecorationInteractions(inGroup: "annotations") { [weak self] event in
            guard let self,
                  let annotation = annotationState.annotations.first(where: { $0.id == event.decoration.id })
            else { return }
            Task { @MainActor in self.editAnnotation(annotation) }
        }
    }

    private func attemptAnnotationReanchoring() {
        let pending = annotationState.annotations.filter {
            !$0.isDeleted && $0.anchorStatus == .review && $0.anchorReason == "asset-revision"
        }
        guard !pending.isEmpty, publication.isSearchable else { return }
        Task { [weak self] in
            guard let self else { return }
            for annotation in pending where !Task.isCancelled {
                guard let locator = await uniqueReanchorCandidate(for: annotation) else { continue }
                acceptAutomaticReanchor(annotation, locator: locator)
            }
        }
    }

    private func uniqueReanchorCandidate(for annotation: ReaderAnnotationRecord) async -> Locator? {
        let exact = await matchingReanchorCandidates(for: annotation)
        if exact.count == 1 { return exact[0] }
        guard exact.count > 1 else { return nil }
        let before = String(normalizedAnchorText(annotation.prefix).suffix(80))
        let after = String(normalizedAnchorText(annotation.suffix).prefix(80))
        guard !before.isEmpty || !after.isEmpty else { return nil }
        let contextual = exact.filter { candidate in
            let candidateBefore = normalizedAnchorText(candidate.text.before ?? "")
            let candidateAfter = normalizedAnchorText(candidate.text.after ?? "")
            return (before.isEmpty || candidateBefore.hasSuffix(before))
                && (after.isEmpty || candidateAfter.hasPrefix(after))
        }
        return contextual.count == 1 ? contextual[0] : nil
    }

    private func matchingReanchorCandidates(for annotation: ReaderAnnotationRecord) async -> [Locator] {
        guard let iterator = try? await publication.search(query: annotation.quote).get() else { return [] }
        var candidates: [Locator] = []
        while candidates.count < 50, !Task.isCancelled {
            guard let page = try? await iterator.next().get() else { break }
            candidates.append(contentsOf: page.locators.prefix(50 - candidates.count))
        }
        return candidates.filter {
            normalizedAnchorText($0.text.highlight ?? "") == normalizedAnchorText(annotation.quote)
        }
    }

    private func acceptAutomaticReanchor(_ original: ReaderAnnotationRecord, locator: Locator) {
        guard let index = annotationState.annotations.firstIndex(where: {
            $0.id == original.id && $0.anchorStatus == .review && !$0.isDeleted
        }) else { return }
        let timestamp = ReaderOutbox.timestamp()
        annotationState.annotations[index].locator = locator
        annotationState.annotations[index].anchorStatus = .reanchored
        annotationState.annotations[index].anchorReason = nil
        annotationState.annotations[index].updatedAt = timestamp
        annotationState.updatedAt = timestamp
        let annotation = annotationState.annotations[index]
        ReaderOutbox.enqueueAnnotation(
            context: context,
            sessionId: sessionId,
            action: "upsert",
            annotationId: annotation.id,
            annotation: annotation
        )
        applyAnnotationDecorations()
    }

    private func normalizedAnchorText(_ value: String) -> String {
        value.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .lowercased()
    }

    private func applyAnnotationDecorations() {
        let decorations = annotationState.annotations.compactMap { annotation -> Decoration? in
            guard !annotation.isDeleted, annotation.anchorStatus != .review else { return nil }
            return Decoration(
                id: annotation.id,
                locator: annotation.locator,
                style: .highlight(tint: annotation.color.tint(theme: effectivePreferences.theme))
            )
        }
        navigator.apply(decorations: decorations, in: "annotations")
    }

    // Readium owns the pan gesture and the adjacent live pages. Intercepting it
    // here would hide the incoming content until the finger is released.
    private func requestPageTurn(_ direction: ReaderPageTurnDirection) {
        guard !(direction == .next ? isAtEnd : isAtStart) else {
            processQueuedPageTurn()
            return
        }
        guard !pageTurnInFlight else {
            if queuedPageTurns.count < 3 { queuedPageTurns.append(direction) }
            return
        }
        pageTurnInFlight = true
        Task {
            let options: NavigatorGoOptions = UIAccessibility.isReduceMotionEnabled ? .none : .animated
            let moved = direction == .next
                ? await navigator.goForward(options: options)
                : await navigator.goBackward(options: options)
            pageTurnInFlight = false
            if !moved { queuedPageTurns.removeAll() }
            processQueuedPageTurn()
        }
    }

    private func processQueuedPageTurn() {
        guard !pageTurnInFlight, !queuedPageTurns.isEmpty else { return }
        requestPageTurn(queuedPageTurns.removeFirst())
    }

    func navigator(_ navigator: any ViewportObservingNavigator, viewportDidChange viewport: NavigatorViewport?) {
        updateReadingBounds(viewport)
        // A reflow can expose the end without changing the page's starting locator.
        if let locator = self.navigator.currentLocation {
            lastLocator = locator
            updateProgress(locator)
            checkpointTimer?.invalidate()
            checkpointTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: false) { [weak self] _ in
                Task { @MainActor in self?.flushLocation() }
            }
        }
    }

    private func updateReadingBounds(_ viewport: NavigatorViewport?) {
        isAtStart = viewport?.resources.first.map {
            $0.href == publication.readingOrder.first?.url() && $0.progression.lowerBound <= 0
        } ?? false
        isAtEnd = viewport?.resources.last.map {
            $0.href == publication.readingOrder.last?.url() && $0.progression.upperBound >= 1
        } ?? false
        previousButton.isEnabled = !isAtStart
        nextButton.isEnabled = !isAtEnd
        if isAtEnd, !didShowFinishFeedback {
            didShowFinishFeedback = true
            feedbackView.show(WovenleafL10n.text("End of book"), symbol: "checkmark")
            UIAccessibility.post(notification: .announcement, argument: WovenleafL10n.text("End of book"))
        } else if !isAtEnd {
            didShowFinishFeedback = false
        }
    }

    private func updateBookmarkButton() {
        let locator = lastLocator ?? navigator.currentLocation
        let bookmarked = locator.map { current in
            navigationState.bookmarks.contains { samePassage($0.locator, current) }
        } ?? false
        bookmarkButton.setSymbol(bookmarked ? "bookmark.fill" : "bookmark")
        bookmarkButton.accessibilityLabel = bookmarked ? WovenleafL10n.text("Remove bookmark") : WovenleafL10n.text("Add bookmark")
        bookmarkButton.accessibilityValue = bookmarked ? WovenleafL10n.text("Bookmarked") : WovenleafL10n.text("Not bookmarked")
    }

    private func samePassage(_ left: Locator, _ right: Locator) -> Bool {
        if left.href != right.href { return false }
        if left.locations.fragments == right.locations.fragments, !left.locations.fragments.isEmpty { return true }
        guard
            let leftProgression = left.locations.progression,
            let rightProgression = right.locations.progression
        else { return left.locations.fragments == right.locations.fragments }
        return abs(leftProgression - rightProgression) < 0.002
    }

    private var readerPalette: ReaderPalette {
        ReaderPalette(
            theme: effectivePreferences.theme,
            highContrast: UIAccessibility.isDarkerSystemColorsEnabled
        )
    }

    private func setupReaderInput() {
        navigator.addObserver(.activate { [weak self] event in
            guard
                let self,
                let target = event.targetElement,
                let image = target.content as? ImageContentElement
            else { return false }
            let detail = ReaderImageViewController(
                publication: publication,
                image: image,
                palette: readerPalette
            )
            let navigation = UINavigationController(rootViewController: detail)
            navigation.modalPresentationStyle = .pageSheet
            present(navigation, animated: !UIAccessibility.isReduceMotionEnabled)
            return true
        }).store(in: &inputObserverTokens)
    }

    private func presentReaderMessage(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("OK"), style: .default))
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    private var effectivePreferences: WovenleafReaderPreferences {
        bookPreferences ?? globalPreferences
    }

    private func savePreferences(
        scope: ReaderPreferenceScope,
        preferences: WovenleafReaderPreferences?
    ) {
        if let pendingPreference, pendingPreference.0 != scope {
            flushPreference()
        }
        if scope == .global, let preferences {
            globalPreferences = preferences
        } else if scope == .book {
            bookPreferences = preferences
        }
        applyPreferences()
        pendingPreference = (scope, preferences)
        preferenceTimer?.invalidate()
        preferenceTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.flushPreference() }
        }
    }

    private func flushPreference() {
        preferenceTimer?.invalidate()
        preferenceTimer = nil
        guard let pendingPreference else { return }
        self.pendingPreference = nil
        ReaderOutbox.enqueuePreference(
            context: context,
            sessionId: sessionId,
            scope: pendingPreference.0,
            preferences: pendingPreference.1
        )
    }

    private func applyPreferences() {
        let renderingPreferences = context.compatibility?.renderingPreferences(effectivePreferences)
            ?? effectivePreferences
        navigator.submitPreferences(renderingPreferences.readiumPreferences(
            compactWidth: usesCompactReadingWidth,
            highContrast: UIAccessibility.isDarkerSystemColorsEnabled
        ))
        applyReaderPalette()
        applyAnnotationDecorations()
    }

    private func applyReaderPalette() {
        let palette = ReaderPalette(
            theme: effectivePreferences.theme,
            highContrast: UIAccessibility.isDarkerSystemColorsEnabled
        )
        view.backgroundColor = palette.page
        topChrome.backgroundColor = palette.page
        bottomChrome.backgroundColor = palette.page
        topChrome.layer.borderColor = palette.rule.cgColor
        topChrome.layer.borderWidth = 0.5
        bottomChrome.layer.borderColor = palette.rule.cgColor
        bottomChrome.layer.borderWidth = 0.5
        titleLabel.textColor = palette.ink
        [libraryButton, appearanceButton, bookmarkButton, outlineButton, previousButton, nextButton, compatibilityButton]
            .forEach { $0.applyPalette(palette) }
        progressControl.applyPalette(palette)
        chapterRail.applyPalette(palette)
        feedbackView.applyPalette(palette)
        textureView.theme = effectivePreferences.theme
        setNeedsStatusBarAppearanceUpdate()
    }
}

@MainActor
private final class ReaderProgressControl: UIStackView {
    var onCommit: ((Double) -> Void)?

    private let slider = UISlider()
    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        axis = .vertical
        alignment = .fill
        spacing = 1
        slider.minimumValue = 0
        slider.maximumValue = 1
        slider.value = 0
        slider.isContinuous = true
        slider.widthAnchor.constraint(equalToConstant: 124).isActive = true
        slider.accessibilityLabel = WovenleafL10n.text("Reading position")
        slider.addTarget(self, action: #selector(valueChanged), for: .valueChanged)
        slider.addTarget(
            self,
            action: #selector(commit),
            for: [.touchUpInside, .touchUpOutside, .touchCancel]
        )
        label.text = WovenleafL10n.text("Opening…")
        label.font = .monospacedDigitSystemFont(ofSize: 10, weight: .medium)
        label.textAlignment = .center
        label.isAccessibilityElement = false
        addArrangedSubview(slider)
        addArrangedSubview(label)
        accessibilityElements = [slider]
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError(WovenleafL10n.text("init(coder:) has not been implemented")) }

    func setProgress(_ progression: Double, label text: String) {
        if !slider.isTracking { slider.value = Float(progression) }
        label.text = text
        slider.accessibilityValue = text
    }

    func setLabel(_ text: String) {
        label.text = text
        slider.accessibilityValue = text
    }

    func applyPalette(_ palette: ReaderPalette) {
        label.textColor = palette.secondaryInk
        slider.minimumTrackTintColor = palette.ink
        slider.maximumTrackTintColor = palette.rule
        slider.thumbTintColor = palette.ink
    }

    @objc private func valueChanged() {
        let percent = "\(Int((Double(slider.value) * 100).rounded()))%"
        label.text = percent
        slider.accessibilityValue = percent
    }

    @objc private func commit() { onCommit?(Double(slider.value)) }
}

private enum ReaderPageTurnDirection {
    case previous
    case next
}

@MainActor
private final class ReaderChromeButton: UIButton {
    init(title: String? = nil, symbol: String? = nil, target: Any?, action: Selector) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 42).isActive = true
        if let title {
            setTitle(title, for: .normal)
            titleLabel?.font = .preferredFont(forTextStyle: .footnote)
            titleLabel?.adjustsFontForContentSizeCategory = true
            contentEdgeInsets = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
        } else {
            widthAnchor.constraint(equalToConstant: 42).isActive = true
            setSymbol(symbol ?? "circle")
        }
        adjustsImageWhenHighlighted = false
        layer.cornerRadius = 12
        addTarget(target, action: action, for: .touchUpInside)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError(WovenleafL10n.text("init(coder:) has not been implemented")) }

    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: 0.1) {
                self.alpha = self.isEnabled ? (self.isHighlighted ? 0.5 : 1) : 0.3
                self.transform = self.isHighlighted ? CGAffineTransform(scaleX: 0.96, y: 0.96) : .identity
            }
        }
    }

    override var isEnabled: Bool {
        didSet { alpha = isEnabled ? 1 : 0.3 }
    }

    func setSymbol(_ name: String) {
        setImage(UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .medium)), for: .normal)
    }

    func applyPalette(_ palette: ReaderPalette) {
        tintColor = palette.ink
        setTitleColor(palette.ink, for: .normal)
        backgroundColor = .clear
    }

    func pulse() {
        guard !UIAccessibility.isReduceMotionEnabled else { return }
        UIView.animateKeyframes(withDuration: 0.28, delay: 0, options: [.allowUserInteraction]) {
            UIView.addKeyframe(withRelativeStartTime: 0, relativeDuration: 0.45) {
                self.transform = CGAffineTransform(scaleX: 0.82, y: 0.82)
            }
            UIView.addKeyframe(withRelativeStartTime: 0.45, relativeDuration: 0.55) {
                self.transform = .identity
            }
        }
    }
}

@MainActor
private final class ReaderFeedbackView: UIView {
    private let icon = UIImageView()
    private let label = UILabel()
    private var hideWorkItem: DispatchWorkItem?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        alpha = 0
        layer.cornerRadius = 16
        layer.borderWidth = 0.5

        icon.contentMode = .scaleAspectFit
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
        icon.widthAnchor.constraint(equalToConstant: 17).isActive = true
        label.font = .preferredFont(forTextStyle: .footnote)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 1

        let stack = UIStackView(arrangedSubviews: [icon, label])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 8
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 13),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -13),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError(WovenleafL10n.text("init(coder:) has not been implemented")) }

    func applyPalette(_ palette: ReaderPalette) {
        backgroundColor = palette.raised
        layer.borderColor = palette.rule.cgColor
        icon.tintColor = palette.ink
        label.textColor = palette.ink
    }

    func show(_ text: String, symbol: String) {
        hideWorkItem?.cancel()
        label.text = text
        icon.image = UIImage(systemName: symbol)
        transform = UIAccessibility.isReduceMotionEnabled
            ? .identity
            : CGAffineTransform(translationX: 0, y: 8).scaledBy(x: 0.97, y: 0.97)
        UIView.animate(
            withDuration: UIAccessibility.isReduceMotionEnabled ? 0.1 : 0.2,
            delay: 0,
            options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction],
            animations: { self.alpha = 1; self.transform = .identity }
        )
        let work = DispatchWorkItem { [weak self] in
            UIView.animate(withDuration: 0.2) { self?.alpha = 0 }
        }
        hideWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.7, execute: work)
    }
}
