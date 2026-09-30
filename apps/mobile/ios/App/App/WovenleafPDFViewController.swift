import PDFKit
import UIKit

/// Fixed-layout documents use PDFKit; EPUB typography preferences never alter a PDF.
final class WovenleafPDFViewController: UIViewController {
    var fileAccess: OriginalFileAccess?
    private let document: PDFDocument
    private let context: ReaderContext
    private let initialLocator: [String: Any]?
    private let pdfView = PDFView()
    private let pageButton = UIButton(type: .system)
    private let previousButton = UIButton(type: .system)
    private let nextButton = UIButton(type: .system)
    private let fitButton = UIButton(type: .system)
    private let paper = UIColor(red: 238/255, green: 237/255, blue: 231/255, alpha: 1)
    private let ink = UIColor(red: 37/255, green: 38/255, blue: 34/255, alpha: 1)
    private var observers: [NSObjectProtocol] = []
    private let observedZoomGestures = NSHashTable<UIGestureRecognizer>.weakObjects()
    private var sessionId = ""
    private var sessionStartedAt = ""
    private var sessionStarted: TimeInterval?
    private var ready = false

    init(url: URL, context: ReaderContext, initialLocator: [String: Any]?) throws {
        guard let document = PDFDocument(url: url), !document.isEncrypted, document.pageCount > 0 else {
            throw NSError(domain: "WovenleafPDF", code: 1, userInfo: [NSLocalizedDescriptionKey: "This PDF is damaged or password-protected."])
        }
        self.document = document
        self.context = context
        self.initialLocator = initialLocator
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError(WovenleafL10n.text("init(coder:) has not been implemented")) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = paper
        view.tintColor = ink
        overrideUserInterfaceStyle = .light
        let library = button(WovenleafL10n.text("Library"), symbol: "chevron.left", action: #selector(closeReader))
        let title = UILabel()
        title.text = context.title
        title.font = .preferredFont(forTextStyle: .subheadline)
        title.adjustsFontForContentSizeCategory = true
        title.textColor = ink
        title.lineBreakMode = .byTruncatingTail
        title.textAlignment = .center
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        configure(fitButton, title: WovenleafL10n.text("Fit page"), symbol: "arrow.up.left.and.arrow.down.right", action: #selector(fitPage))
        // Keep a stable toolbar width while removing the unnecessary action.
        fitButton.alpha = 0
        fitButton.isUserInteractionEnabled = false
        fitButton.accessibilityElementsHidden = true
        let top = UIStackView(arrangedSubviews: [library, title, fitButton])
        top.alignment = .center
        top.spacing = 12
        configure(previousButton, title: WovenleafL10n.text("Previous page"), symbol: "chevron.left", action: #selector(previousPage))
        configure(nextButton, title: WovenleafL10n.text("Next page"), symbol: "chevron.right", action: #selector(nextPage))
        pageButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        pageButton.titleLabel?.adjustsFontForContentSizeCategory = true
        pageButton.addTarget(self, action: #selector(goToPage), for: .touchUpInside)
        pageButton.accessibilityHint = WovenleafL10n.text("Choose a page number")
        let bottom = UIStackView(arrangedSubviews: [previousButton, pageButton, nextButton])
        bottom.alignment = .center
        bottom.distribution = .equalSpacing
        pdfView.backgroundColor = paper
        pdfView.displayMode = .singlePage
        pdfView.displayDirection = .horizontal
        pdfView.usePageViewController(true, withViewOptions: [UIPageViewController.OptionsKey.interPageSpacing: 12])
        pdfView.displaysPageBreaks = true
        pdfView.document = document
        pdfView.autoScales = true
        for child in [top, pdfView, bottom] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: safe.topAnchor),
            top.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            top.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            top.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
            pdfView.topAnchor.constraint(equalTo: top.bottomAnchor),
            pdfView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            pdfView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            pdfView.bottomAnchor.constraint(equalTo: bottom.topAnchor),
            bottom.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20),
            bottom.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -20),
            bottom.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            bottom.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
            pageButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        observe(.PDFViewPageChanged) { [weak self] in self?.pageChanged() }
        observe(.PDFViewScaleChanged) { [weak self] in
            // PDFKit's page controller may emit this from its per-page PDFView
            // before the outer view has updated its current scale.
            DispatchQueue.main.async { self?.updateFitButton() }
        }
        observe(UIApplication.willResignActiveNotification) { [weak self] in self?.endSession() }
        observe(UIApplication.didBecomeActiveNotification) { [weak self] in self?.beginSession() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !ready else { return }
        let locations = initialLocator?["locations"] as? [String: Any]
        let position = locations?["position"] as? Int
        let progression = locations?["totalProgression"] as? Double ?? 0
        let index = max(0, min(document.pageCount - 1, position.map { $0 - 1 } ?? Int(ceil(progression * Double(document.pageCount))) - 1))
        if let page = document.page(at: index) { pdfView.go(to: page) }
        ready = true
        observePageZoom(in: pdfView)
        beginSession()
        pageChanged()
    }

    override func viewWillDisappear(_ animated: Bool) {
        endSession()
        super.viewWillDisappear(animated)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        observePageZoom(in: pdfView)
        updateFitButton()
    }

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(input: UIKeyCommand.inputLeftArrow, modifierFlags: [], action: #selector(previousPage)),
            UIKeyCommand(input: UIKeyCommand.inputRightArrow, modifierFlags: [], action: #selector(nextPage)),
            UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(closeReader)),
        ]
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    private var pageIndex: Int { pdfView.currentPage.map(document.index(for:)) ?? 0 }

    private func pageChanged() {
        guard ready else { return }
        pageButton.setTitle(WovenleafL10n.text("Page {{page}} of {{total}}", ["page": String(pageIndex + 1), "total": String(document.pageCount)]), for: .normal)
        previousButton.isEnabled = pageIndex > 0
        nextButton.isEnabled = pageIndex < document.pageCount - 1
        observePageZoom(in: pdfView)
        updateFitButton()
        emit("location")
    }

    private func beginSession() {
        guard ready, sessionStarted == nil else { return }
        sessionId = "reading-session:pdf:\(UUID().uuidString.lowercased())"
        sessionStartedAt = ReaderOutbox.timestamp()
        sessionStarted = ProcessInfo.processInfo.systemUptime
        emit("start")
    }

    private func endSession() {
        guard let started = sessionStarted else { return }
        emit("session", extra: [
            "startedAt": sessionStartedAt,
            "endedAt": ReaderOutbox.timestamp(),
            "activeDurationMs": Int((ProcessInfo.processInfo.systemUptime - started) * 1000),
        ])
        sessionStarted = nil
    }

    private func emit(_ kind: String, extra: [String: Any] = [:]) {
        guard ready, sessionStarted != nil else { return }
        var values = extra
        values["toolkitVersion"] = "PDFKit"
        values["reachedEnd"] = pageIndex == document.pageCount - 1
        values["locator"] = [
            "href": "document.pdf", "type": "application/pdf", "title": "Page \(pageIndex + 1)",
            "locations": [
                "position": pageIndex + 1, "pageCount": document.pageCount,
                "totalProgression": Double(pageIndex + 1) / Double(document.pageCount),
                "fragments": ["page=\(pageIndex + 1)"],
            ],
        ]
        ReaderOutbox.enqueue(kind: kind, context: context, sessionId: sessionId, locator: nil, extra: values)
    }

    private func observe(_ name: Notification.Name, action: @escaping () -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: name == .PDFViewPageChanged ? pdfView : nil, queue: .main) { _ in action() })
    }

    private func button(_ title: String, symbol: String, action: Selector) -> UIButton {
        let result = UIButton(type: .system)
        configure(result, title: title, symbol: symbol, action: action)
        return result
    }

    private func configure(_ button: UIButton, title: String, symbol: String, action: Selector) {
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.accessibilityLabel = title
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        if title == WovenleafL10n.text("Library") {
            var config = UIButton.Configuration.plain()
            config.title = title
            config.image = UIImage(systemName: symbol)
            config.imagePadding = 6
            button.configuration = config
        }
    }

    @objc private func closeReader() { endSession(); dismiss(animated: true) }
    private func observePageZoom(in view: UIView) {
        // Paged PDFKit omits scale notifications for double-tap zoom. Add an
        // observer target to its gestures, preserving their delegates/behavior.
        for gesture in view.gestureRecognizers ?? [] {
            if (gesture is UIPinchGestureRecognizer || gesture is UITapGestureRecognizer),
               !observedZoomGestures.contains(gesture) {
                observedZoomGestures.add(gesture)
                gesture.addTarget(self, action: #selector(zoomGestureChanged(_:)))
            }
        }
        view.subviews.forEach { observePageZoom(in: $0) }
    }

    @objc private func zoomGestureChanged(_ gesture: UIGestureRecognizer) {
        updateFitButton()
        if gesture.state == .ended || gesture.state == .cancelled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.updateFitButton() }
        }
    }

    private func updateFitButton() {
        let fittedScale = pdfView.scaleFactorForSizeToFit
        let needsFit = ready && fittedScale > 0 && pdfView.scaleFactor > 0
            && abs(pdfView.scaleFactor / fittedScale - 1) > 0.01
        fitButton.alpha = needsFit ? 1 : 0
        fitButton.isUserInteractionEnabled = needsFit
        fitButton.accessibilityElementsHidden = !needsFit
    }

    @objc private func fitPage() {
        pdfView.autoScales = true
        pdfView.scaleFactor = pdfView.scaleFactorForSizeToFit
        updateFitButton()
    }
    @objc private func previousPage() { if let page = document.page(at: pageIndex - 1) { pdfView.go(to: page) } }
    @objc private func nextPage() { if let page = document.page(at: pageIndex + 1) { pdfView.go(to: page) } }

    @objc private func goToPage() {
        let alert = UIAlertController(title: WovenleafL10n.text("Go to page"), message: "1–\(document.pageCount)", preferredStyle: .alert)
        alert.addTextField { field in
            field.keyboardType = .numberPad
            field.text = String(self.pageIndex + 1)
            field.accessibilityLabel = WovenleafL10n.text("Page number")
        }
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Cancel"), style: .cancel))
        alert.addAction(UIAlertAction(title: WovenleafL10n.text("Go"), style: .default) { [weak self] _ in
            guard let self, let number = Int(alert.textFields?.first?.text ?? ""), let page = self.document.page(at: max(0, min(self.document.pageCount - 1, number - 1))) else { return }
            self.pdfView.go(to: page)
        })
        present(alert, animated: true)
    }
}
