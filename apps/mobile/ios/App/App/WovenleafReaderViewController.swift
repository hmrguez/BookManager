import ReadiumNavigator
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
    private let progressLabel = UILabel()
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
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            image: UIImage(systemName: "textformat.size"),
            style: .plain,
            target: self,
            action: #selector(showReaderSettings)
        )
        navigationItem.rightBarButtonItem?.accessibilityLabel = "Reading appearance"

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

        progressLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        progressLabel.text = "Opening…"
        let flexibleSpace = UIBarButtonItem(
            barButtonSystemItem: .flexibleSpace,
            target: nil,
            action: nil
        )
        toolbarItems = [
            UIBarButtonItem(title: "Previous", style: .plain, target: self, action: #selector(previousPage)),
            flexibleSpace,
            UIBarButtonItem(customView: progressLabel),
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(title: "Next", style: .plain, target: self, action: #selector(nextPage)),
        ]
        navigationController?.setToolbarHidden(false, animated: false)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(flushForLifecycle),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        applyReaderPalette()
        ReaderOutbox.enqueue(kind: "start", context: context, sessionId: sessionId, locator: initialLocator)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        effectivePreferences.theme == .graphite ? .lightContent : .darkContent
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
        checkpointTimer?.invalidate()
        checkpointTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.flushLocation() }
        }
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
            progressLabel.text = "\(Int((progression * 100).rounded()))%"
        } else {
            progressLabel.text = locator.title ?? "Reading"
        }
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
        progressLabel.textColor = palette.secondaryInk
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
