import ReadiumNavigator
import ReadiumShared
import UIKit

@MainActor
final class WovenleafReaderViewController: UIViewController, EPUBNavigatorDelegate {
    private let publication: Publication
    private let navigator: EPUBNavigatorViewController
    private let initialLocator: Locator?
    private var context: ReaderContext
    private let sessionId = "reading-session:reader:\(UUID().uuidString.lowercased())"
    private let sessionStartedAt = Date()
    private let sessionStartedUptime = ProcessInfo.processInfo.systemUptime
    private var checkpointTimer: Timer?
    private var lastLocator: Locator?
    private let progressLabel = UILabel()

    init(publication: Publication, initialLocator: Locator?, context: ReaderContext) throws {
        self.publication = publication
        self.context = context
        self.initialLocator = initialLocator
        self.navigator = try EPUBNavigatorViewController(
            publication: publication,
            initialLocation: initialLocator,
            config: .init(
                preferences: EPUBPreferences(
                    fontFamily: .serif,
                    lineHeight: 1.5,
                    pageMargins: 1.15,
                    publisherStyles: false,
                    scroll: context.layout == .scroll
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
        view.backgroundColor = UIColor(red: 0.965, green: 0.949, blue: 0.902, alpha: 1)
        title = context.title
        navigationItem.largeTitleDisplayMode = .never
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            title: "Library",
            style: .plain,
            target: self,
            action: #selector(closeReader)
        )
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: context.layout == .scroll ? "Pages" : "Scroll",
            style: .plain,
            target: self,
            action: #selector(toggleLayout)
        )

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

        progressLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        progressLabel.textColor = .secondaryLabel
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
        ReaderOutbox.enqueue(kind: "start", context: context, sessionId: sessionId, locator: initialLocator)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        checkpointTimer?.invalidate()
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

    @objc private func toggleLayout() {
        context.layout = context.layout == .scroll ? .paginated : .scroll
        navigator.submitPreferences(EPUBPreferences(scroll: context.layout == .scroll))
        navigationItem.rightBarButtonItem?.title = context.layout == .scroll ? "Pages" : "Scroll"
        flushLocation()
    }

    @objc private func flushForLifecycle() {
        flushLocation()
    }

    @objc private func closeReader() {
        checkpointTimer?.invalidate()
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
}
