@_spi(ExperimentalTargetElement) import ReadiumNavigator
import AVFoundation
import ReadiumShared
import UIKit

@MainActor
final class WovenleafReaderViewController: UIViewController, EPUBNavigatorDelegate, UIGestureRecognizerDelegate {
    private static let readerRightPadding: CGFloat = 8

    private let publication: Publication
    private let navigator: EPUBNavigatorViewController
    private let initialLocator: Locator?
    private let context: ReaderContext
    private var globalPreferences: WovenleafReaderPreferences
    private var bookPreferences: WovenleafReaderPreferences?
    private let sessionId = "reading-session:reader:\(UUID().uuidString.lowercased())"
    private let sessionStartedAt = Date()
    private let sessionStartedUptime = ProcessInfo.processInfo.systemUptime
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
    private lazy var libraryButton = ReaderChromeButton(title: "Library", target: self, action: #selector(closeReader))
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
    private let pageEdge = ReaderPageEdgeView()
    private var lastChapterHref: String?
    private var didShowFinishFeedback = false
    private var pageTurnInFlight = false
    private var queuedPageTurns: [ReaderPageTurnDirection] = []
    private var interactiveTurnDirection: ReaderPageTurnDirection?
    private var interactiveTurnProgress: CGFloat = 0
    private let motionProbe = ReaderMotionProbe()

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
                    compactWidth: UIScreen.main.bounds.width < 700,
                    highContrast: UIAccessibility.isDarkerSystemColorsEnabled
                ),
                editingActions: EditingAction.defaultActions + [
                    EditingAction(title: "Highlight", action: #selector(createHighlight(_:))),
                    EditingAction(title: "Add Note", action: #selector(createPassageNote(_:))),
                    EditingAction(title: "Read Aloud", action: #selector(readSelectionAloud(_:))),
                ]
            )
        )
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationController?.setNavigationBarHidden(true, animated: false)
        navigationController?.setToolbarHidden(true, animated: false)
        view.backgroundColor = readerPalette.page

        libraryButton.accessibilityLabel = "Close reader and return to library"
        appearanceButton.accessibilityLabel = "Reading appearance"
        bookmarkButton.accessibilityLabel = "Add bookmark"
        outlineButton.accessibilityLabel = "Browse chapters, bookmarks, notes, and search"
        previousButton.accessibilityLabel = "Previous page"
        nextButton.accessibilityLabel = "Next page"
        compatibilityButton.accessibilityLabel = "Reading compatibility"
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

        pageEdge.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pageEdge)
        NSLayoutConstraint.activate([
            pageEdge.leadingAnchor.constraint(equalTo: navigator.view.leadingAnchor),
            pageEdge.trailingAnchor.constraint(equalTo: navigator.view.trailingAnchor),
            pageEdge.topAnchor.constraint(equalTo: navigator.view.topAnchor),
            pageEdge.bottomAnchor.constraint(equalTo: navigator.view.bottomAnchor),
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
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        applyReaderPalette()
        updateBookmarkButton()
        setupReaderInput()
        setupPageTurnGesture()
        loadChapterRail()
        setupAnnotationInteractions()
        applyAnnotationDecorations()
        attemptAnnotationReanchoring()
        ReaderOutbox.enqueue(kind: "start", context: context, sessionId: sessionId, locator: initialLocator)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !presentedCompatibilityNotice, context.compatibility?.notices.isEmpty == false {
            presentedCompatibilityNotice = true
            showCompatibilityNotice()
        } else {
            UIAccessibility.post(notification: .screenChanged, argument: navigator.view)
        }
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

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.applyPreferences()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
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
            chapterRail.updateActive(locator: lastLocator ?? navigator.currentLocation)
        }
    }

    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        let previousChapter = lastChapterHref
        lastLocator = locator
        updateProgress(locator)
        updateBookmarkButton()
        chapterRail.updateActive(locator: locator)
        lastChapterHref = locator.href.string
        if let previousChapter, previousChapter != locator.href.string {
            chapterRail.revealActiveMomentarily()
            feedbackView.show(locator.title ?? "New chapter", symbol: "text.book.closed")
        }
        if (locator.locations.totalProgression ?? 0) >= 0.9995, !didShowFinishFeedback {
            didShowFinishFeedback = true
            feedbackView.show("End of book", symbol: "checkmark")
            UIAccessibility.post(notification: .announcement, argument: "End of book")
        } else if (locator.locations.totalProgression ?? 0) < 0.995 {
            didShowFinishFeedback = false
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
                title: "Link blocked",
                message: "Wovenleaf only hands web links to your browser. This link uses an unsupported address type."
            )
            return
        }
        let destination = url.host ?? "your browser"
        let alert = UIAlertController(
            title: "Leave Wovenleaf?",
            message: "Open \(destination) in your default browser? The book file and Wovenleaf’s private storage are not shared.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open in Browser", style: .default) { _ in
            UIApplication.shared.open(url, options: [:])
        })
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    func navigator(_ navigator: Navigator, presentError error: NavigatorError) {
        let alert = UIAlertController(
            title: "Page unavailable",
            message: "Wovenleaf kept your last trusted reading position.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
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
            UIAccessibility.post(notification: .announcement, argument: "Bookmark removed")
            feedbackView.show("Bookmark removed", symbol: "bookmark.slash")
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
        UIAccessibility.post(notification: .announcement, argument: "Bookmark added")
        feedbackView.show("Page kept", symbol: "bookmark.fill")
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
            compactWidth: traitCollection.horizontalSizeClass == .compact
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
        flushPreference()
        flushLocation()
    }

    @objc private func closeReader() {
        checkpointTimer?.invalidate()
        motionProbe.cancel()
        for token in inputObserverTokens {
            navigator.removeObserver(token)
        }
        inputObserverTokens.removeAll()
        speechSynthesizer.stopSpeaking(at: .immediate)
        flushPreference()
        flushLocation()
        let endedAt = Date()
        ReaderOutbox.enqueue(
            kind: "session",
            context: context,
            sessionId: sessionId,
            locator: lastLocator ?? navigator.currentLocation,
            startedAt: ReaderOutbox.timestamp(sessionStartedAt),
            endedAt: ReaderOutbox.timestamp(endedAt),
            activeDurationMs: max(0, Int((ProcessInfo.processInfo.systemUptime - sessionStartedUptime) * 1_000))
        )
        navigationController?.dismiss(animated: true)
    }

    private func flushLocation() {
        checkpointTimer?.invalidate()
        checkpointTimer = nil
        guard let locator = lastLocator ?? navigator.currentLocation else { return }
        ReaderOutbox.enqueue(kind: "location", context: context, sessionId: sessionId, locator: locator)
    }

    private func updateProgress(_ locator: Locator) {
        if let progression = locator.locations.totalProgression {
            progressControl.setProgress(progression, label: "\(Int((progression * 100).rounded()))%")
        } else {
            progressControl.setLabel(locator.title ?? "Reading")
        }
    }

    private func navigate(to link: Link, fromToc: Bool = false) {
        pendingJumpOrigin = lastLocator ?? navigator.currentLocation
        Task {
            guard await navigator.go(to: link, options: .animated) else {
                pendingJumpOrigin = nil
                presentReaderMessage(title: "Section unavailable", message: "This book’s navigation entry is broken or missing.")
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
                presentReaderMessage(title: "Passage unavailable", message: "Wovenleaf could not recover this passage in the current edition.")
            }
        }
    }

    private func scrub(to progression: Double) {
        Task {
            guard let locator = await publication.locate(progression: progression) else {
                presentReaderMessage(
                    title: "Position unavailable",
                    message: "This book does not provide enough navigation data for precise scrubbing."
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
                title: "Select a passage",
                message: "Select a passage first, then choose Read Aloud."
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
        UIAccessibility.post(notification: .announcement, argument: "Reading selected passage aloud")
    }

    @objc private func showCompatibilityNotice() {
        guard let profile = context.compatibility, !profile.notices.isEmpty else { return }
        let alert = UIAlertController(
            title: "Reading this edition",
            message: profile.notices.joined(separator: "\n\n"),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { [weak self] _ in
            guard let self else { return }
            UIAccessibility.post(notification: .screenChanged, argument: self.navigator.view)
        })
        present(alert, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    private func createAnnotationFromSelection() {
        guard let selection = navigator.currentSelection else {
            presentReaderMessage(title: "Select a passage", message: "Select a short passage first, then choose Highlight or Add Note.")
            return
        }
        let quote = selection.locator.text.highlight?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !quote.isEmpty, quote.count <= 10_000 else {
            navigator.clearSelection()
            presentReaderMessage(
                title: "Selection unavailable",
                message: "Choose a passage between 1 and 10,000 characters. Wovenleaf does not save whole chapters as annotations."
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
                    title: "Passage unavailable",
                    message: "This revised EPUB no longer contains the quoted passage. The annotation remains in Needs Review."
                )
                return
            }
            if candidates.count == 1 {
                openReviewCandidate(candidates[0], annotation: annotation)
                return
            }
            let chooser = UIAlertController(
                title: "Choose the matching passage",
                message: "The quote appears more than once. Compare its chapter and surrounding words before confirming.",
                preferredStyle: .alert
            )
            for candidate in candidates.prefix(12) {
                chooser.addAction(UIAlertAction(title: reviewCandidateLabel(candidate), style: .default) { [weak self] _ in
                    self?.openReviewCandidate(candidate, annotation: annotation)
                })
            }
            chooser.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            present(chooser, animated: !UIAccessibility.isReduceMotionEnabled)
        }
    }

    private func openReviewCandidate(_ locator: Locator, annotation: ReaderAnnotationRecord) {
        Task {
            guard await navigator.go(to: locator, options: .animated) else {
                presentReaderMessage(title: "Passage unavailable", message: "This matching range could not be opened.")
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
        UIAccessibility.post(notification: .announcement, argument: existing == nil ? "Highlight saved" : "Annotation updated")
        feedbackView.show(existing == nil ? "Passage marked" : "Note updated", symbol: "pencil.line")
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
            title: "Annotation deleted",
            message: "The deletion is retained for sync and portable export. You can undo it now.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Done", style: .cancel))
        alert.addAction(UIAlertAction(title: "Undo", style: .default) { [weak self] _ in
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
        UIAccessibility.post(notification: .announcement, argument: "Annotation restored")
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

    private func setupPageTurnGesture() {
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePagePan(_:)))
        pan.delegate = self
        pan.maximumNumberOfTouches = 1
        pan.cancelsTouchesInView = true
        navigator.view.addGestureRecognizer(pan)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard
            effectivePreferences.layout == .paginated,
            !pageTurnInFlight,
            navigator.currentSelection == nil,
            let pan = gestureRecognizer as? UIPanGestureRecognizer
        else { return false }
        let velocity = pan.velocity(in: navigator.view)
        return abs(velocity.x) > max(30, abs(velocity.y) * 1.25)
    }

    @objc private func handlePagePan(_ gesture: UIPanGestureRecognizer) {
        let width = max(1, navigator.view.bounds.width)
        let translation = gesture.translation(in: navigator.view).x
        switch gesture.state {
        case .began:
            guard !pageTurnInFlight else { return }
            pageTurnInFlight = true
            interactiveTurnDirection = direction(forTranslation: translation == 0 ? gesture.velocity(in: navigator.view).x : translation)
            motionProbe.begin(interactive: true)
        case .changed:
            guard pageTurnInFlight else { return }
            let direction = direction(forTranslation: translation)
            interactiveTurnDirection = direction
            interactiveTurnProgress = min(1, abs(translation) / (width * 0.28))
            updateInteractiveTurn(translation: translation, progress: interactiveTurnProgress, direction: direction)
        case .ended:
            guard pageTurnInFlight, let direction = interactiveTurnDirection else { return }
            let velocity = gesture.velocity(in: navigator.view).x
            let shouldCommit = interactiveTurnProgress >= 0.48 || abs(velocity) >= 560
            if shouldCommit {
                commitPageTurn(direction, interactive: true)
            } else {
                reverseInteractiveTurn()
            }
        case .cancelled, .failed:
            if pageTurnInFlight { reverseInteractiveTurn() }
        default:
            break
        }
    }

    private func requestPageTurn(_ direction: ReaderPageTurnDirection) {
        guard effectivePreferences.layout == .paginated else {
            Task {
                if direction == .next {
                    _ = await navigator.goForward(options: .animated)
                } else {
                    _ = await navigator.goBackward(options: .animated)
                }
            }
            return
        }
        guard !pageTurnInFlight else {
            if queuedPageTurns.count < 3 { queuedPageTurns.append(direction) }
            return
        }
        pageTurnInFlight = true
        motionProbe.begin(interactive: false)
        commitPageTurn(direction, interactive: false)
    }

    private func commitPageTurn(_ direction: ReaderPageTurnDirection, interactive: Bool) {
        let sign = visualSign(for: direction)
        let finishLift = { [weak self] in
            guard let self else { return }
            self.applyPageLift(offset: sign * self.pageTurnTravel, progress: 1)
        }
        let completion = { [weak self] in
            guard let self else { return }
            Task {
                let moved = direction == .next
                    ? await self.navigator.goForward(options: .none)
                    : await self.navigator.goBackward(options: .none)
                self.finishPageTurn(moved: moved, direction: direction)
            }
        }
        if UIAccessibility.isReduceMotionEnabled {
            pageEdge.update(progress: 0.72, direction: sign, palette: readerPalette)
            UIView.animate(
                withDuration: 0.1,
                animations: { self.navigator.view.alpha = 0.78 }
            ) { _ in completion() }
        } else {
            UIView.animate(
                withDuration: interactive ? 0.12 : 0.22,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction],
                animations: finishLift
            ) { _ in completion() }
        }
    }

    private func finishPageTurn(moved: Bool, direction: ReaderPageTurnDirection) {
        UIView.performWithoutAnimation {
            navigator.view.layer.transform = CATransform3DIdentity
            navigator.view.layer.shadowOpacity = 0
            navigator.view.alpha = moved ? 0.76 : 1
            pageEdge.reset()
        }
        let finish = { [weak self] in
            guard let self else { return }
            navigator.view.alpha = 1
            interactiveTurnDirection = nil
            interactiveTurnProgress = 0
            pageTurnInFlight = false
            motionProbe.finish(committed: moved, reversed: false)
            if !moved, direction == .next {
                feedbackView.show("End of book", symbol: "checkmark")
            }
            processQueuedPageTurn()
        }
        if UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.11, animations: { self.navigator.view.alpha = 1 }) { _ in finish() }
        } else {
            UIView.animate(
                withDuration: 0.18,
                delay: 0,
                options: [.curveEaseOut, .beginFromCurrentState, .allowUserInteraction],
                animations: { self.navigator.view.alpha = 1 }
            ) { _ in finish() }
        }
    }

    private func reverseInteractiveTurn() {
        UIView.animate(
            withDuration: UIAccessibility.isReduceMotionEnabled ? 0.1 : 0.2,
            delay: 0,
            usingSpringWithDamping: 0.92,
            initialSpringVelocity: 0,
            options: [.beginFromCurrentState, .allowUserInteraction],
            animations: {
                self.navigator.view.layer.transform = CATransform3DIdentity
                self.navigator.view.layer.shadowOpacity = 0
                self.navigator.view.alpha = 1
                self.pageEdge.reset()
            }
        ) { _ in
            self.interactiveTurnDirection = nil
            self.interactiveTurnProgress = 0
            self.pageTurnInFlight = false
            self.motionProbe.finish(committed: false, reversed: true)
            self.processQueuedPageTurn()
        }
    }

    private func updateInteractiveTurn(
        translation: CGFloat,
        progress: CGFloat,
        direction: ReaderPageTurnDirection
    ) {
        let clamped = max(-pageTurnTravel, min(pageTurnTravel, translation))
        if UIAccessibility.isReduceMotionEnabled {
            pageEdge.update(progress: progress, direction: visualSign(for: direction), palette: readerPalette)
            navigator.view.alpha = 1 - progress * 0.1
        } else {
            applyPageLift(offset: clamped, progress: progress)
        }
    }

    private func applyPageLift(offset: CGFloat, progress: CGFloat) {
        var transform = CATransform3DIdentity
        transform.m34 = -1 / 900
        transform = CATransform3DTranslate(transform, offset, 0, min(18, progress * 18))
        transform = CATransform3DRotate(transform, (offset < 0 ? -1 : 1) * progress * 0.035, 0, 1, 0)
        navigator.view.layer.transform = transform
        navigator.view.layer.shadowColor = UIColor.black.cgColor
        navigator.view.layer.shadowOpacity = Float(progress * 0.16)
        navigator.view.layer.shadowRadius = 14
        navigator.view.layer.shadowOffset = CGSize(width: offset < 0 ? 7 : -7, height: 0)
        pageEdge.update(progress: progress, direction: offset < 0 ? -1 : 1, palette: readerPalette)
    }

    private var pageTurnTravel: CGFloat {
        navigator.view.bounds.width * 0.28
    }

    private func direction(forTranslation translation: CGFloat) -> ReaderPageTurnDirection {
        let movingTowardEnd = context.compatibility?.isRightToLeft == true ? translation > 0 : translation < 0
        return movingTowardEnd ? .next : .previous
    }

    private func visualSign(for direction: ReaderPageTurnDirection) -> CGFloat {
        let nextSign: CGFloat = context.compatibility?.isRightToLeft == true ? 1 : -1
        return direction == .next ? nextSign : -nextSign
    }

    private func processQueuedPageTurn() {
        guard !queuedPageTurns.isEmpty else { return }
        requestPageTurn(queuedPageTurns.removeFirst())
    }

    private func updateBookmarkButton() {
        let locator = lastLocator ?? navigator.currentLocation
        let bookmarked = locator.map { current in
            navigationState.bookmarks.contains { samePassage($0.locator, current) }
        } ?? false
        bookmarkButton.setSymbol(bookmarked ? "bookmark.fill" : "bookmark")
        bookmarkButton.accessibilityLabel = bookmarked ? "Remove bookmark" : "Add bookmark"
        bookmarkButton.accessibilityValue = bookmarked ? "Bookmarked" : "Not bookmarked"
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
        alert.addAction(UIAlertAction(title: "OK", style: .default))
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
            compactWidth: traitCollection.horizontalSizeClass == .compact,
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
        slider.accessibilityLabel = "Reading position"
        slider.addTarget(self, action: #selector(valueChanged), for: .valueChanged)
        slider.addTarget(
            self,
            action: #selector(commit),
            for: [.touchUpInside, .touchUpOutside, .touchCancel]
        )
        label.text = "Opening…"
        label.font = .monospacedDigitSystemFont(ofSize: 10, weight: .medium)
        label.textAlignment = .center
        label.isAccessibilityElement = false
        addArrangedSubview(slider)
        addArrangedSubview(label)
        accessibilityElements = [slider]
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

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
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: 0.1) {
                self.alpha = self.isHighlighted ? 0.5 : 1
                self.transform = self.isHighlighted ? CGAffineTransform(scaleX: 0.96, y: 0.96) : .identity
            }
        }
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
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

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

@MainActor
private final class ReaderPageEdgeView: UIView {
    private var progress: CGFloat = 0
    private var direction: CGFloat = 1
    private var color = UIColor.clear

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        isOpaque = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func update(progress: CGFloat, direction: CGFloat, palette: ReaderPalette) {
        self.progress = min(1, max(0, progress))
        self.direction = direction
        color = palette.ink
        setNeedsDisplay()
    }

    func reset() {
        progress = 0
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        guard progress > 0, let context = UIGraphicsGetCurrentContext() else { return }
        let width = max(2, 14 * progress)
        let edge = direction < 0 ? bounds.maxX - width : bounds.minX
        let edgeRect = CGRect(x: edge, y: 0, width: width, height: bounds.height)
        context.setFillColor(color.withAlphaComponent(0.05 + progress * 0.09).cgColor)
        context.fill(edgeRect)
        context.setFillColor(color.withAlphaComponent(0.28 + progress * 0.32).cgColor)
        context.fill(CGRect(x: direction < 0 ? bounds.maxX - 1 : bounds.minX, y: 0, width: 1, height: bounds.height))
    }
}

@MainActor
private final class ReaderMotionProbe {
    private var displayLink: CADisplayLink?
    private var startedAt: CFTimeInterval = 0
    private var previousFrame: CFTimeInterval = 0
    private var frames = 0
    private var lateFrames = 0
    private var interactive = false

    func begin(interactive: Bool) {
        cancel()
        self.interactive = interactive
        startedAt = CACurrentMediaTime()
        previousFrame = 0
        frames = 0
        lateFrames = 0
        let link = CADisplayLink(target: self, selector: #selector(frame(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func finish(committed: Bool, reversed: Bool) {
        guard displayLink != nil else { return }
        let duration = (CACurrentMediaTime() - startedAt) * 1_000
        cancel()
        #if DEBUG
        NSLog(
            "Wovenleaf reader turn: %.1fms, %d frames, %d late, interactive=%@, committed=%@, reversed=%@",
            duration,
            frames,
            lateFrames,
            interactive.description,
            committed.description,
            reversed.description
        )
        #endif
    }

    func cancel() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func frame(_ link: CADisplayLink) {
        if previousFrame > 0, link.timestamp - previousFrame > link.duration * 1.55 { lateFrames += 1 }
        previousFrame = link.timestamp
        frames += 1
    }
}
