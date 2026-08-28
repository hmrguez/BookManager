@_spi(ExperimentalTargetElement) import ReadiumNavigator
import ReadiumShared
import UIKit

@MainActor
final class WovenleafReaderViewController: UIViewController, EPUBNavigatorDelegate {
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
    private var navigationHistory: [Locator] = []
    private var pendingJumpOrigin: Locator?
    private var restoringHistory = false
    private var inputObserverTokens: Set<InputObservableToken> = []
    private let progressControl = ReaderProgressControl()
    private lazy var historyButton = UIBarButtonItem(
        image: UIImage(systemName: "arrow.uturn.backward"),
        style: .plain,
        target: self,
        action: #selector(goBackInBook)
    )
    private lazy var bookmarkButton = UIBarButtonItem(
        image: UIImage(systemName: "bookmark"),
        style: .plain,
        target: self,
        action: #selector(toggleBookmark)
    )
    private let textureView = PaperTextureView()

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
        let preferences = bookPreferences ?? globalPreferences
        self.navigator = try EPUBNavigatorViewController(
            publication: publication,
            initialLocation: initialLocator,
            config: .init(
                preferences: preferences.readiumPreferences(
                    compactWidth: UIScreen.main.bounds.width < 700,
                    highContrast: UIAccessibility.isDarkerSystemColorsEnabled
                )
            )
        )
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = context.title
        navigationItem.largeTitleDisplayMode = .never
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Library",
            style: .plain,
            target: self,
            action: #selector(closeReader)
        )
        let appearanceButton = UIBarButtonItem(
            image: UIImage(systemName: "textformat.size"),
            style: .plain,
            target: self,
            action: #selector(showReaderSettings)
        )
        appearanceButton.accessibilityLabel = "Reading appearance"
        bookmarkButton.accessibilityLabel = "Add bookmark"
        navigationItem.rightBarButtonItems = [appearanceButton, bookmarkButton]

        addChild(navigator)
        navigator.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(navigator.view)
        NSLayoutConstraint.activate([
            navigator.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navigator.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            navigator.view.topAnchor.constraint(equalTo: view.topAnchor),
            navigator.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
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

        progressControl.onCommit = { [weak self] progression in
            self?.scrub(to: progression)
        }
        let flexibleSpace = UIBarButtonItem(
            barButtonSystemItem: .flexibleSpace,
            target: nil,
            action: nil
        )
        toolbarItems = [
            UIBarButtonItem(
                image: UIImage(systemName: "list.bullet.indent"),
                style: .plain,
                target: self,
                action: #selector(showReaderOutline)
            ),
            historyButton,
            flexibleSpace,
            UIBarButtonItem(customView: progressControl),
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(
                image: UIImage(systemName: "chevron.backward"),
                style: .plain,
                target: self,
                action: #selector(previousPage)
            ),
            UIBarButtonItem(
                image: UIImage(systemName: "chevron.forward"),
                style: .plain,
                target: self,
                action: #selector(nextPage)
            ),
        ]
        toolbarItems?[0].accessibilityLabel = "Contents, bookmarks, and search"
        historyButton.accessibilityLabel = "Return to previous passage"
        toolbarItems?[5].accessibilityLabel = "Previous page"
        toolbarItems?[6].accessibilityLabel = "Next page"
        navigationController?.setToolbarHidden(false, animated: false)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(flushForLifecycle),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        applyReaderPalette()
        updateHistoryButton()
        updateBookmarkButton()
        setupReaderInput()
        ReaderOutbox.enqueue(kind: "start", context: context, sessionId: sessionId, locator: initialLocator)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        effectivePreferences.theme == .graphite ? .lightContent : .darkContent
    }

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(input: UIKeyCommand.inputLeftArrow, modifierFlags: [], action: #selector(previousPage)),
            UIKeyCommand(input: UIKeyCommand.inputRightArrow, modifierFlags: [], action: #selector(nextPage)),
            UIKeyCommand(input: "f", modifierFlags: .command, action: #selector(showReaderOutline)),
            UIKeyCommand(input: "b", modifierFlags: .command, action: #selector(toggleBookmark)),
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

    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        lastLocator = locator
        updateProgress(locator)
        updateBookmarkButton()
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
        updateHistoryButton()
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
        Task { await navigator.goBackward(options: .animated) }
    }

    @objc private func nextPage() {
        Task { await navigator.goForward(options: .animated) }
    }

    @objc private func showReaderOutline() {
        let outline = ReaderOutlineViewController(
            publication: publication,
            currentLocator: lastLocator ?? navigator.currentLocation,
            selectedTocLocator: navigationState.toc?.locator,
            bookmarks: navigationState.bookmarks,
            palette: readerPalette
        )
        outline.onNavigateToLink = { [weak self] link in self?.navigate(to: link, fromToc: true) }
        outline.onNavigateToLocator = { [weak self] locator in self?.navigate(to: locator) }
        outline.onDeleteBookmark = { [weak self] bookmark in self?.deleteBookmark(bookmark) }
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
        updateHistoryButton()
        Task {
            if !(await navigator.go(to: locator, options: .animated)) {
                restoringHistory = false
                navigationHistory.append(locator)
                updateHistoryButton()
            }
        }
    }

    @objc private func toggleBookmark() {
        guard let locator = lastLocator ?? navigator.currentLocation else { return }
        if let existing = navigationState.bookmarks.first(where: { samePassage($0.locator, locator) }) {
            deleteBookmark(existing)
            UIAccessibility.post(notification: .announcement, argument: "Bookmark removed")
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
    }

    @objc private func handleEscape() {
        if presentedViewController != nil {
            dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
        } else if !navigationHistory.isEmpty {
            goBackInBook()
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
        for token in inputObserverTokens {
            navigator.removeObserver(token)
        }
        inputObserverTokens.removeAll()
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

    private func updateBookmarkButton() {
        let locator = lastLocator ?? navigator.currentLocation
        let bookmarked = locator.map { current in
            navigationState.bookmarks.contains { samePassage($0.locator, current) }
        } ?? false
        bookmarkButton.image = UIImage(systemName: bookmarked ? "bookmark.fill" : "bookmark")
        bookmarkButton.accessibilityLabel = bookmarked ? "Remove bookmark" : "Add bookmark"
        bookmarkButton.accessibilityValue = bookmarked ? "Bookmarked" : "Not bookmarked"
    }

    private func updateHistoryButton() {
        historyButton.isEnabled = !navigationHistory.isEmpty
        historyButton.accessibilityValue = navigationHistory.isEmpty
            ? "No previous passage"
            : "\(navigationHistory.count) previous passage\(navigationHistory.count == 1 ? "" : "s")"
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
        navigator.submitPreferences(effectivePreferences.readiumPreferences(
            compactWidth: traitCollection.horizontalSizeClass == .compact,
            highContrast: UIAccessibility.isDarkerSystemColorsEnabled
        ))
        applyReaderPalette()
    }

    private func applyReaderPalette() {
        let palette = ReaderPalette(
            theme: effectivePreferences.theme,
            highContrast: UIAccessibility.isDarkerSystemColorsEnabled
        )
        view.backgroundColor = palette.page
        progressControl.applyPalette(palette)
        textureView.theme = effectivePreferences.theme
        navigationController?.navigationBar.tintColor = palette.ink
        navigationController?.toolbar.tintColor = palette.ink

        let navigationAppearance = UINavigationBarAppearance()
        navigationAppearance.configureWithOpaqueBackground()
        navigationAppearance.backgroundColor = palette.page
        navigationAppearance.shadowColor = palette.rule
        navigationAppearance.titleTextAttributes = [.foregroundColor: palette.ink]
        navigationController?.navigationBar.standardAppearance = navigationAppearance
        navigationController?.navigationBar.scrollEdgeAppearance = navigationAppearance

        let toolbarAppearance = UIToolbarAppearance()
        toolbarAppearance.configureWithOpaqueBackground()
        toolbarAppearance.backgroundColor = palette.page
        toolbarAppearance.shadowColor = palette.rule
        navigationController?.toolbar.standardAppearance = toolbarAppearance
        if #available(iOS 15.0, *) {
            navigationController?.toolbar.scrollEdgeAppearance = toolbarAppearance
        }
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
