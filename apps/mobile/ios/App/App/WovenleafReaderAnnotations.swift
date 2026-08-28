import ReadiumShared
import UIKit

enum ReaderAnnotationColor: String, CaseIterable {
    case ochre
    case sage
    case blue
    case rose

    var label: String {
        switch self {
        case .ochre: return "Ochre"
        case .sage: return "Sage"
        case .blue: return "Slate"
        case .rose: return "Rose"
        }
    }

    func tint(theme: WovenleafReaderPreferences.ThemeChoice) -> UIColor {
        let hex: String
        switch (self, theme) {
        case (.ochre, .graphite): hex = "#E7BE69"
        case (.sage, .graphite): hex = "#A8C49B"
        case (.blue, .graphite): hex = "#91B7D0"
        case (.rose, .graphite): hex = "#D7A19C"
        case (.ochre, _): hex = "#C39B47"
        case (.sage, _): hex = "#789269"
        case (.blue, _): hex = "#668BA5"
        case (.rose, _): hex = "#AD7672"
        }
        return UIColor(readerHex: hex)
    }
}

enum ReaderAnnotationAnchorStatus: String {
    case exact
    case reanchored
    case review
}

struct ReaderAnnotationRecord {
    let id: String
    let bookId: String
    var editionId: String
    var assetId: String
    var assetFingerprint: String
    var locator: Locator
    let quote: String
    let prefix: String
    let suffix: String
    let chapter: String?
    var color: ReaderAnnotationColor
    var note: String
    var tags: [String]
    let createdAt: String
    var updatedAt: String
    var deletedAt: String?
    var anchorStatus: ReaderAnnotationAnchorStatus
    var previousAssetFingerprint: String?
    var anchorReason: String?
    let platform: String
    let toolkitVersion: String

    init?(_ object: [String: Any]) {
        guard
            let id = object["id"] as? String,
            let bookId = object["bookId"] as? String,
            let editionId = object["editionId"] as? String,
            let assetId = object["assetId"] as? String,
            let assetFingerprint = object["assetFingerprint"] as? String,
            let locatorObject = object["locator"] as? [String: Any],
            let locator = readerLocator(from: locatorObject),
            let quote = object["quote"] as? String,
            let prefix = object["prefix"] as? String,
            let suffix = object["suffix"] as? String,
            let colorValue = object["color"] as? String,
            let color = ReaderAnnotationColor(rawValue: colorValue),
            let note = object["note"] as? String,
            let tags = object["tags"] as? [String],
            let createdAt = object["createdAt"] as? String,
            let updatedAt = object["updatedAt"] as? String,
            let anchor = object["anchor"] as? [String: Any],
            let anchorValue = anchor["status"] as? String,
            let anchorStatus = ReaderAnnotationAnchorStatus(rawValue: anchorValue),
            let provenance = object["provenance"] as? [String: Any],
            provenance["source"] as? String == "epub-reader",
            let platform = provenance["platform"] as? String,
            let toolkitVersion = provenance["toolkitVersion"] as? String
        else { return nil }
        self.id = id
        self.bookId = bookId
        self.editionId = editionId
        self.assetId = assetId
        self.assetFingerprint = assetFingerprint
        self.locator = locator
        self.quote = quote
        self.prefix = prefix
        self.suffix = suffix
        chapter = object["chapter"] as? String
        self.color = color
        self.note = note
        self.tags = tags
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        deletedAt = object["deletedAt"] as? String
        self.anchorStatus = anchorStatus
        previousAssetFingerprint = anchor["previousAssetFingerprint"] as? String
        anchorReason = anchor["reason"] as? String
        self.platform = platform
        self.toolkitVersion = toolkitVersion
    }

    init(
        id: String,
        context: ReaderContext,
        locator: Locator,
        color: ReaderAnnotationColor,
        note: String,
        tags: [String],
        timestamp: String
    ) {
        self.id = id
        bookId = context.bookId
        editionId = context.editionId
        assetId = context.assetId
        assetFingerprint = context.assetFingerprint
        self.locator = locator
        quote = locator.text.highlight?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        prefix = String((locator.text.before ?? "").suffix(1_000))
        suffix = String((locator.text.after ?? "").prefix(1_000))
        chapter = locator.title.map { String($0.prefix(500)) }
        self.color = color
        self.note = note
        self.tags = tags
        createdAt = timestamp
        updatedAt = timestamp
        deletedAt = nil
        anchorStatus = .exact
        previousAssetFingerprint = nil
        anchorReason = nil
        platform = "ios"
        toolkitVersion = "3.11.0"
    }

    var object: [String: Any] {
        var anchor: [String: Any] = ["status": anchorStatus.rawValue]
        if let previousAssetFingerprint { anchor["previousAssetFingerprint"] = previousAssetFingerprint }
        if let anchorReason { anchor["reason"] = anchorReason }
        var value: [String: Any] = [
            "id": id,
            "bookId": bookId,
            "editionId": editionId,
            "assetId": assetId,
            "assetFingerprint": assetFingerprint,
            "locator": locator.jsonObject.mapValues(\.any),
            "quote": quote,
            "prefix": prefix,
            "suffix": suffix,
            "color": color.rawValue,
            "note": note,
            "tags": tags,
            "createdAt": createdAt,
            "updatedAt": updatedAt,
            "anchor": anchor,
            "provenance": [
                "source": "epub-reader",
                "platform": platform,
                "toolkitVersion": toolkitVersion,
            ],
        ]
        if let chapter { value["chapter"] = chapter }
        if let deletedAt { value["deletedAt"] = deletedAt }
        return value
    }

    var isDeleted: Bool { deletedAt != nil }
}

struct ReaderAnnotationCollection {
    let bookId: String
    let editionId: String
    var annotations: [ReaderAnnotationRecord]
    var updatedAt: String

    init?(object: [String: Any]?) {
        guard
            let object,
            (object["version"] as? NSNumber)?.intValue == 1,
            let bookId = object["bookId"] as? String,
            let editionId = object["editionId"] as? String,
            let updatedAt = object["updatedAt"] as? String,
            let values = object["annotations"] as? [[String: Any]]
        else { return nil }
        self.bookId = bookId
        self.editionId = editionId
        self.updatedAt = updatedAt
        annotations = values.compactMap(ReaderAnnotationRecord.init)
    }
}

@MainActor
final class ReaderAnnotationEditorViewController: UIViewController {
    var onSave: ((ReaderAnnotationColor, String, [String]) -> Void)?
    var onDelete: (() -> Void)?

    private let quote: String
    private let annotation: ReaderAnnotationRecord?
    private let palette: ReaderPalette
    private let needsReview: Bool
    private let colorControl = UISegmentedControl(items: ReaderAnnotationColor.allCases.map(\.label))
    private let noteView = UITextView()
    private let tagsField = UITextField()

    init(quote: String, annotation: ReaderAnnotationRecord?, palette: ReaderPalette, needsReview: Bool = false) {
        self.quote = quote
        self.annotation = annotation
        self.palette = palette
        self.needsReview = needsReview
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = needsReview ? "Review highlight" : (annotation == nil ? "New highlight" : "Edit highlight")
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(close)
        )
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: needsReview ? "Keep Here" : "Save",
            style: .done,
            target: self,
            action: #selector(save)
        )

        let scrollView = UIScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.spacing = 16
        stack.isLayoutMarginsRelativeArrangement = true
        stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 22, leading: 20, bottom: 32, trailing: 20)

        if needsReview {
            let review = insetLabel(
                "This EPUB revision changed the original range. Confirm only if this is the same passage; Wovenleaf never moves an ambiguous highlight silently.",
                font: .preferredFont(forTextStyle: .subheadline)
            )
            review.textColor = palette.ink
            review.backgroundColor = palette.raised
            review.layer.borderColor = palette.rule.cgColor
            review.layer.borderWidth = 1
            stack.addArrangedSubview(review)
        }

        let quoteLabel = insetLabel("“\(quote)”", font: .preferredFont(forTextStyle: .body))
        quoteLabel.textColor = palette.ink
        quoteLabel.backgroundColor = palette.raised
        quoteLabel.accessibilityLabel = "Selected passage: \(quote)"
        stack.addArrangedSubview(sectionLabel("PASSAGE"))
        stack.addArrangedSubview(quoteLabel)

        colorControl.selectedSegmentIndex = ReaderAnnotationColor.allCases.firstIndex(
            of: annotation?.color ?? .ochre
        ) ?? 0
        colorControl.accessibilityLabel = "Highlight color"
        stack.addArrangedSubview(sectionLabel("COLOR"))
        stack.addArrangedSubview(colorControl)

        noteView.text = annotation?.note ?? ""
        noteView.font = .preferredFont(forTextStyle: .body)
        noteView.adjustsFontForContentSizeCategory = true
        noteView.textColor = palette.ink
        noteView.backgroundColor = palette.raised
        noteView.layer.borderColor = palette.rule.cgColor
        noteView.layer.borderWidth = 1
        noteView.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        noteView.heightAnchor.constraint(greaterThanOrEqualToConstant: 132).isActive = true
        noteView.accessibilityLabel = "Passage note"
        stack.addArrangedSubview(sectionLabel("NOTE"))
        stack.addArrangedSubview(noteView)

        tagsField.text = annotation?.tags.joined(separator: ", ") ?? ""
        tagsField.placeholder = "Theme, character, revisit"
        tagsField.font = .preferredFont(forTextStyle: .body)
        tagsField.textColor = palette.ink
        tagsField.backgroundColor = palette.raised
        tagsField.layer.borderColor = palette.rule.cgColor
        tagsField.layer.borderWidth = 1
        tagsField.setLeftPadding(12)
        tagsField.heightAnchor.constraint(equalToConstant: 48).isActive = true
        tagsField.accessibilityLabel = "Tags, separated by commas"
        stack.addArrangedSubview(sectionLabel("TAGS"))
        stack.addArrangedSubview(tagsField)

        let boundary = UILabel()
        boundary.numberOfLines = 0
        boundary.font = .preferredFont(forTextStyle: .footnote)
        boundary.textColor = palette.secondaryInk
        boundary.text = "Wovenleaf saves only the passage you selected, never hidden chapter text. Protected EPUBs remain unsupported."
        stack.addArrangedSubview(boundary)

        if annotation != nil {
            let delete = UIButton(type: .system)
            delete.setTitle("Delete annotation", for: .normal)
            delete.setTitleColor(.systemRed, for: .normal)
            delete.heightAnchor.constraint(equalToConstant: 46).isActive = true
            delete.addTarget(self, action: #selector(deleteAnnotation), for: .touchUpInside)
            stack.addArrangedSubview(delete)
        }

        view.backgroundColor = palette.page
        scrollView.addSubview(stack)
        view.addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            stack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
        ])
        navigationController?.navigationBar.tintColor = palette.ink
    }

    private func sectionLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .caption1)
        label.textColor = palette.secondaryInk
        return label
    }

    private func insetLabel(_ text: String, font: UIFont) -> UILabel {
        let label = ReaderInsetLabel()
        label.text = text
        label.font = font
        label.numberOfLines = 0
        return label
    }

    @objc private func save() {
        let color = ReaderAnnotationColor.allCases[colorControl.selectedSegmentIndex]
        let tags = normalizeTags(tagsField.text ?? "")
        onSave?(color, String(noteView.text.prefix(50_000)), tags)
        dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
    }

    @objc private func deleteAnnotation() {
        onDelete?()
        dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
    }

    @objc private func close() { dismiss(animated: !UIAccessibility.isReduceMotionEnabled) }

    private func normalizeTags(_ raw: String) -> [String] {
        var seen = Set<String>()
        return raw.split(separator: ",")
            .map {
                $0.components(separatedBy: .whitespacesAndNewlines)
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
            }
            .filter { !$0.isEmpty && $0.count <= 64 }
            .filter { seen.insert($0.lowercased()).inserted }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            .prefix(32)
            .map { $0 }
    }
}

private final class ReaderInsetLabel: UILabel {
    private let insets = UIEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)

    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: insets)) }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: size.width + insets.left + insets.right, height: size.height + insets.top + insets.bottom)
    }
}

private extension UITextField {
    func setLeftPadding(_ amount: CGFloat) {
        let spacer = UIView(frame: CGRect(x: 0, y: 0, width: amount, height: 1))
        leftView = spacer
        leftViewMode = .always
    }
}
