import ReadiumNavigator
import UIKit

enum ReaderPreferenceScope: String {
    case global
    case book
}

struct WovenleafReaderPreferences: Codable, Equatable {
    enum FontFamilyChoice: String, Codable, CaseIterable {
        case literary
        case sans
        case mono
        case accessible

        var label: String {
            switch self {
            case .literary: return "Literary"
            case .sans: return "Sans"
            case .mono: return "Mono"
            case .accessible: return "Accessible"
            }
        }
    }

    enum TextAlignmentChoice: String, Codable {
        case start
        case justify
    }

    enum ColumnChoice: String, Codable {
        case auto
        case one
        case two
    }

    enum LayoutChoice: String, Codable {
        case paginated
        case scroll
    }

    enum ThemeChoice: String, Codable {
        case paper
        case white
        case graphite
    }

    let version: Int
    var fontFamily: FontFamilyChoice
    var fontSize: Double
    var fontWeight: Double
    var lineHeight: Double
    var pageMargins: Double
    var textAlign: TextAlignmentChoice
    var hyphens: Bool
    var columnCount: ColumnChoice
    var layout: LayoutChoice
    var theme: ThemeChoice
    var publisherStyles: Bool

    init(
        version: Int,
        fontFamily: FontFamilyChoice,
        fontSize: Double,
        fontWeight: Double,
        lineHeight: Double,
        pageMargins: Double,
        textAlign: TextAlignmentChoice,
        hyphens: Bool,
        columnCount: ColumnChoice,
        layout: LayoutChoice,
        theme: ThemeChoice,
        publisherStyles: Bool
    ) {
        self.version = version
        self.fontFamily = fontFamily
        self.fontSize = fontSize
        self.fontWeight = fontWeight
        self.lineHeight = lineHeight
        self.pageMargins = pageMargins
        self.textAlign = textAlign
        self.hyphens = hyphens
        self.columnCount = columnCount
        self.layout = layout
        self.theme = theme
        self.publisherStyles = publisherStyles
    }

    static let standard = WovenleafReaderPreferences(
        version: 1,
        fontFamily: .literary,
        fontSize: 1,
        fontWeight: 1,
        lineHeight: 1.5,
        pageMargins: 1.15,
        textAlign: .justify,
        hyphens: true,
        columnCount: .auto,
        layout: .paginated,
        theme: .paper,
        publisherStyles: false
    )

    init?(object: [String: Any]?) {
        guard
            let object,
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            let decoded = try? JSONDecoder().decode(Self.self, from: data)
        else { return nil }
        self = decoded.validated
    }

    var object: [String: Any] {
        guard
            let data = try? JSONEncoder().encode(self),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return object
    }

    var validated: Self {
        var value = self
        value.fontSize = value.fontSize.clamped(to: 0.8 ... 2)
        value.fontWeight = value.fontWeight.clamped(to: 0.75 ... 1.5)
        value.lineHeight = value.lineHeight.clamped(to: 1.2 ... 1.9)
        value.pageMargins = value.pageMargins.clamped(to: 0.4 ... 2.5)
        return value
    }

    func readiumPreferences(compactWidth: Bool, highContrast: Bool = false) -> EPUBPreferences {
        let palette = ReaderPalette(theme: theme, highContrast: highContrast)
        let family: FontFamily? = publisherStyles ? nil : {
            switch fontFamily {
            case .literary: return .iowanOldStyle
            case .sans: return .seravek
            case .mono: return .iaWriterDuospace
            case .accessible: return .openDyslexic
            }
        }()
        let columns: ColumnCount = {
            guard layout == .paginated else { return .one }
            switch columnCount {
            case .auto: return compactWidth ? .one : .two
            case .one: return .one
            case .two: return compactWidth ? .one : .two
            }
        }()
        return EPUBPreferences(
            backgroundColor: ReadiumNavigator.Color(hex: palette.pageHex),
            columnCount: columns,
            fontFamily: family,
            fontSize: fontSize,
            fontWeight: fontWeight,
            hyphens: publisherStyles ? nil : hyphens,
            imageFilter: theme == .graphite ? .darken : nil,
            lineHeight: publisherStyles ? nil : lineHeight,
            pageMargins: pageMargins,
            publisherStyles: publisherStyles,
            scroll: layout == .scroll,
            textAlign: publisherStyles ? nil : (textAlign == .justify ? .justify : .start),
            textColor: ReadiumNavigator.Color(hex: palette.inkHex),
            textNormalization: true,
            theme: theme == .graphite ? .dark : .light
        )
    }
}

struct ReaderPalette {
    let pageHex: String
    let raisedHex: String
    let inkHex: String
    let secondaryHex: String
    let ruleHex: String
    let inverseInkHex: String

    init(theme: WovenleafReaderPreferences.ThemeChoice, highContrast: Bool = false) {
        switch (theme, highContrast) {
        case (.paper, false):
            (pageHex, raisedHex, inkHex, secondaryHex, ruleHex, inverseInkHex) =
                ("#EEEDE7", "#F7F6F1", "#252622", "#5D5E58", "#A7A69F", "#F7F6F1")
        case (.white, false):
            (pageHex, raisedHex, inkHex, secondaryHex, ruleHex, inverseInkHex) =
                ("#F8F8F5", "#FFFFFF", "#20211F", "#5B5C58", "#AAAFAA", "#FFFFFF")
        case (.graphite, false):
            (pageHex, raisedHex, inkHex, secondaryHex, ruleHex, inverseInkHex) =
                ("#20211F", "#2A2B28", "#DFDFD7", "#B4B4AC", "#555650", "#20211F")
        case (.paper, true):
            (pageHex, raisedHex, inkHex, secondaryHex, ruleHex, inverseInkHex) =
                ("#F2F1EB", "#FFFFFF", "#090A08", "#292A27", "#343530", "#FFFFFF")
        case (.white, true):
            (pageHex, raisedHex, inkHex, secondaryHex, ruleHex, inverseInkHex) =
                ("#FFFFFF", "#FFFFFF", "#000000", "#252623", "#30312E", "#FFFFFF")
        case (.graphite, true):
            (pageHex, raisedHex, inkHex, secondaryHex, ruleHex, inverseInkHex) =
                ("#090A09", "#111210", "#FFFFFF", "#E0E0D9", "#B5B6B0", "#090A09")
        }
    }

    var page: UIColor { UIColor(readerHex: pageHex) }
    var raised: UIColor { UIColor(readerHex: raisedHex) }
    var ink: UIColor { UIColor(readerHex: inkHex) }
    var secondaryInk: UIColor { UIColor(readerHex: secondaryHex) }
    var rule: UIColor { UIColor(readerHex: ruleHex) }
    var inverseInk: UIColor { UIColor(readerHex: inverseInkHex) }
}

@MainActor
final class ReaderSettingsViewController: UIViewController {
    var onSave: ((ReaderPreferenceScope, WovenleafReaderPreferences?) -> Void)?

    private var globalPreferences: WovenleafReaderPreferences
    private var bookPreferences: WovenleafReaderPreferences?
    private var scope: ReaderPreferenceScope
    private let compactWidth: Bool
    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()
    private let scopeControl = UISegmentedControl(items: ["All books", "This book"])
    private let themeControl = UISegmentedControl(items: ["Paper", "White", "Graphite"])
    private let typefacePicker = ReaderTypefacePicker()
    private let sizeSlider = UISlider()
    private let weightSlider = UISlider()
    private let lineHeightSlider = UISlider()
    private let marginSlider = UISlider()
    private let sizeValue = UILabel()
    private let weightValue = UILabel()
    private let lineHeightValue = UILabel()
    private let marginValue = UILabel()
    private let alignmentControl = UISegmentedControl(items: ["Ragged", "Justified"])
    private let hyphenationSwitch = UISwitch()
    private let columnControl = UISegmentedControl(items: ["Auto", "One", "Two"])
    private let layoutControl = UISegmentedControl(items: ["Pages", "Scroll"])
    private let publisherSwitch = UISwitch()
    private let publisherHint = UILabel()

    init(
        globalPreferences: WovenleafReaderPreferences,
        bookPreferences: WovenleafReaderPreferences?,
        compactWidth: Bool
    ) {
        self.globalPreferences = globalPreferences
        self.bookPreferences = bookPreferences
        self.scope = bookPreferences == nil ? .global : .book
        self.compactWidth = compactWidth
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Reading surface"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Done",
            style: .done,
            target: self,
            action: #selector(close)
        )
        buildView()
        syncControls()
        applyPalette()
    }

    private var preferences: WovenleafReaderPreferences {
        scope == .book ? (bookPreferences ?? globalPreferences) : globalPreferences
    }

    private func buildView() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        view.addSubview(scrollView)
        contentStack.axis = .vertical
        contentStack.spacing = 24
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 20),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -20),
            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 20),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -30),
            contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -40),
        ])

        let introduction = UILabel()
        introduction.numberOfLines = 0
        introduction.font = .preferredFont(forTextStyle: .subheadline)
        introduction.adjustsFontForContentSizeCategory = true
        introduction.text = "Tune the page without losing your place. Changes appear in the open passage and are kept for every book or only this one."
        contentStack.addArrangedSubview(introduction)

        scopeControl.addTarget(self, action: #selector(scopeChanged), for: .valueChanged)
        contentStack.addArrangedSubview(section(title: "Apply to", views: [scopeControl]))

        themeControl.addTarget(self, action: #selector(themeChanged), for: .valueChanged)
        contentStack.addArrangedSubview(section(title: "Paper", views: [themeControl]))

        typefacePicker.onSelect = { [weak self] choice in
            self?.mutate { $0.fontFamily = choice }
        }
        contentStack.addArrangedSubview(section(title: "Typeface", views: [typefacePicker]))

        configure(slider: sizeSlider, minimum: 0.8, maximum: 2, action: #selector(sizeChanged))
        configure(slider: weightSlider, minimum: 0.75, maximum: 1.5, action: #selector(weightChanged))
        configure(slider: lineHeightSlider, minimum: 1.2, maximum: 1.9, action: #selector(lineHeightChanged))
        contentStack.addArrangedSubview(section(title: "Type", views: [
            sliderRow(title: "Size", valueLabel: sizeValue, slider: sizeSlider),
            sliderRow(title: "Ink weight", valueLabel: weightValue, slider: weightSlider),
            sliderRow(title: "Line spacing", valueLabel: lineHeightValue, slider: lineHeightSlider),
        ]))

        configure(slider: marginSlider, minimum: 0.4, maximum: 2.5, action: #selector(marginChanged))
        alignmentControl.addTarget(self, action: #selector(alignmentChanged), for: .valueChanged)
        hyphenationSwitch.addTarget(self, action: #selector(hyphenationChanged), for: .valueChanged)
        contentStack.addArrangedSubview(section(title: "Composition", views: [
            sliderRow(title: "Margins", valueLabel: marginValue, slider: marginSlider),
            labelledControl(title: "Alignment", control: alignmentControl),
            labelledControl(title: "Hyphenation", control: hyphenationSwitch),
        ]))

        columnControl.addTarget(self, action: #selector(columnsChanged), for: .valueChanged)
        layoutControl.addTarget(self, action: #selector(layoutChanged), for: .valueChanged)
        contentStack.addArrangedSubview(section(title: "Movement", views: [
            labelledControl(title: "Reading mode", control: layoutControl),
            labelledControl(title: "Columns", control: columnControl),
        ]))

        publisherSwitch.addTarget(self, action: #selector(publisherChanged), for: .valueChanged)
        publisherHint.numberOfLines = 0
        publisherHint.font = .preferredFont(forTextStyle: .footnote)
        publisherHint.adjustsFontForContentSizeCategory = true
        publisherHint.text = "Original styling remains available, while Wovenleaf keeps a safe text size and readable ink contrast."
        contentStack.addArrangedSubview(section(title: "Book design", views: [
            labelledControl(title: "Use publisher styling", control: publisherSwitch),
            publisherHint,
        ]))

        let lightHint = UILabel()
        lightHint.numberOfLines = 0
        lightHint.font = .preferredFont(forTextStyle: .footnote)
        lightHint.adjustsFontForContentSizeCategory = true
        lightHint.text = "Match the page to the room: lower device brightness until the page stops glowing. Wovenleaf leaves system brightness under your control, like a front light on an e-reader."
        contentStack.addArrangedSubview(section(title: "Ambient light", views: [lightHint]))

        let reset = UIButton(type: .system)
        reset.setTitle("Reset to quiet paper", for: .normal)
        reset.titleLabel?.font = .preferredFont(forTextStyle: .body)
        reset.addTarget(self, action: #selector(resetPreferences), for: .touchUpInside)
        reset.contentHorizontalAlignment = .leading
        contentStack.addArrangedSubview(reset)
    }

    private func section(title: String, views: [UIView]) -> UIView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 10
        let heading = UILabel()
        heading.text = title.uppercased()
        heading.font = .preferredFont(forTextStyle: .caption1)
        heading.adjustsFontForContentSizeCategory = true
        heading.accessibilityTraits = .header
        heading.tag = 101
        stack.addArrangedSubview(heading)
        views.forEach(stack.addArrangedSubview)
        return stack
    }

    private func labelledControl(title: String, control: UIView) -> UIView {
        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        let label = UILabel()
        label.text = title
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        row.addArrangedSubview(label)
        row.addArrangedSubview(control)
        return row
    }

    private func sliderRow(title: String, valueLabel: UILabel, slider: UISlider) -> UIView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 5
        let header = UIStackView()
        header.axis = .horizontal
        let label = UILabel()
        label.text = title
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        valueLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        valueLabel.textAlignment = .right
        valueLabel.setContentHuggingPriority(.required, for: .horizontal)
        header.addArrangedSubview(label)
        header.addArrangedSubview(valueLabel)
        stack.addArrangedSubview(header)
        stack.addArrangedSubview(slider)
        return stack
    }

    private func configure(slider: UISlider, minimum: Float, maximum: Float, action: Selector) {
        slider.minimumValue = minimum
        slider.maximumValue = maximum
        slider.isContinuous = true
        slider.addTarget(self, action: action, for: .valueChanged)
    }

    private func mutate(_ change: (inout WovenleafReaderPreferences) -> Void) {
        if scope == .book {
            var updated = bookPreferences ?? globalPreferences
            change(&updated)
            bookPreferences = updated.validated
            onSave?(.book, bookPreferences)
        } else {
            change(&globalPreferences)
            globalPreferences = globalPreferences.validated
            onSave?(.global, globalPreferences)
        }
        syncControls()
        applyPalette()
    }

    private func syncControls() {
        let value = preferences
        scopeControl.selectedSegmentIndex = scope == .global ? 0 : 1
        themeControl.selectedSegmentIndex = [.paper, .white, .graphite].firstIndex(of: value.theme) ?? 0
        typefacePicker.select(value.fontFamily)
        sizeSlider.value = Float(value.fontSize)
        weightSlider.value = Float(value.fontWeight)
        lineHeightSlider.value = Float(value.lineHeight)
        marginSlider.value = Float(value.pageMargins)
        sizeValue.text = "\(Int((value.fontSize * 100).rounded()))%"
        weightValue.text = "\(Int((value.fontWeight * 100).rounded()))%"
        lineHeightValue.text = String(format: "%.2f", value.lineHeight)
        marginValue.text = String(format: "%.2f", value.pageMargins)
        alignmentControl.selectedSegmentIndex = value.textAlign == .start ? 0 : 1
        hyphenationSwitch.isOn = value.hyphens
        columnControl.selectedSegmentIndex = [.auto, .one, .two].firstIndex(of: value.columnCount) ?? 0
        layoutControl.selectedSegmentIndex = value.layout == .paginated ? 0 : 1
        publisherSwitch.isOn = value.publisherStyles
        let advancedEnabled = !value.publisherStyles
        [typefacePicker, weightSlider, lineHeightSlider, alignmentControl, hyphenationSwitch].forEach {
            $0.isUserInteractionEnabled = advancedEnabled
            $0.alpha = advancedEnabled ? 1 : 0.42
        }
        let columnsEnabled = value.layout == .paginated
        columnControl.isUserInteractionEnabled = columnsEnabled
        columnControl.alpha = columnsEnabled ? 1 : 0.42
        columnControl.setEnabled(!compactWidth, forSegmentAt: 2)
    }

    private func applyPalette() {
        let palette = ReaderPalette(
            theme: preferences.theme,
            highContrast: UIAccessibility.isDarkerSystemColorsEnabled
        )
        view.backgroundColor = palette.page
        navigationController?.navigationBar.tintColor = palette.ink
        let navigationAppearance = UINavigationBarAppearance()
        navigationAppearance.configureWithOpaqueBackground()
        navigationAppearance.backgroundColor = palette.page
        navigationAppearance.shadowColor = palette.rule
        navigationAppearance.titleTextAttributes = [.foregroundColor: palette.ink]
        navigationController?.navigationBar.standardAppearance = navigationAppearance
        navigationController?.navigationBar.scrollEdgeAppearance = navigationAppearance
        recolor(view, palette: palette)
        typefacePicker.applyPalette(palette)
    }

    private func recolor(_ root: UIView, palette: ReaderPalette) {
        if let label = root as? UILabel {
            label.textColor = label.tag == 101 ? palette.secondaryInk : palette.ink
        } else if let button = root as? UIButton {
            button.tintColor = palette.ink
            button.setTitleColor(palette.ink, for: .normal)
            button.layer.borderColor = palette.rule.cgColor
        } else if let segmented = root as? UISegmentedControl {
            segmented.selectedSegmentTintColor = palette.ink
            segmented.setTitleTextAttributes([.foregroundColor: palette.ink], for: .normal)
            segmented.setTitleTextAttributes([.foregroundColor: palette.inverseInk], for: .selected)
        } else if let slider = root as? UISlider {
            slider.minimumTrackTintColor = palette.ink
            slider.maximumTrackTintColor = palette.rule
            slider.thumbTintColor = palette.ink
        } else if let toggle = root as? UISwitch {
            toggle.onTintColor = palette.ink
            toggle.thumbTintColor = toggle.isOn ? palette.inverseInk : palette.raised
        }
        root.subviews.forEach { recolor($0, palette: palette) }
    }

    @objc private func close() { dismiss(animated: !UIAccessibility.isReduceMotionEnabled) }

    @objc private func scopeChanged() {
        let next: ReaderPreferenceScope = scopeControl.selectedSegmentIndex == 0 ? .global : .book
        guard next != scope else { return }
        scope = next
        if next == .book, bookPreferences == nil {
            bookPreferences = globalPreferences
            onSave?(.book, bookPreferences)
        } else if next == .global, bookPreferences != nil {
            bookPreferences = nil
            onSave?(.book, nil)
        }
        syncControls()
        applyPalette()
    }

    @objc private func themeChanged() {
        let themes: [WovenleafReaderPreferences.ThemeChoice] = [.paper, .white, .graphite]
        mutate { $0.theme = themes[themeControl.selectedSegmentIndex] }
    }

    @objc private func sizeChanged() { mutate { $0.fontSize = Double(sizeSlider.value).rounded(step: 0.05) } }
    @objc private func weightChanged() { mutate { $0.fontWeight = Double(weightSlider.value).rounded(step: 0.05) } }
    @objc private func lineHeightChanged() { mutate { $0.lineHeight = Double(lineHeightSlider.value).rounded(step: 0.05) } }
    @objc private func marginChanged() { mutate { $0.pageMargins = Double(marginSlider.value).rounded(step: 0.05) } }
    @objc private func alignmentChanged() { mutate { $0.textAlign = alignmentControl.selectedSegmentIndex == 0 ? .start : .justify } }
    @objc private func hyphenationChanged() { mutate { $0.hyphens = hyphenationSwitch.isOn } }

    @objc private func columnsChanged() {
        let columns: [WovenleafReaderPreferences.ColumnChoice] = [.auto, .one, .two]
        mutate { $0.columnCount = columns[columnControl.selectedSegmentIndex] }
    }

    @objc private func layoutChanged() {
        mutate { $0.layout = layoutControl.selectedSegmentIndex == 0 ? .paginated : .scroll }
    }

    @objc private func publisherChanged() { mutate { $0.publisherStyles = publisherSwitch.isOn } }

    @objc private func resetPreferences() {
        if scope == .book {
            bookPreferences = nil
            scope = .global
            onSave?(.book, nil)
        } else {
            globalPreferences = .standard
            onSave?(.global, globalPreferences)
        }
        syncControls()
        applyPalette()
    }
}

@MainActor
private final class ReaderTypefacePicker: UIStackView {
    var onSelect: ((WovenleafReaderPreferences.FontFamilyChoice) -> Void)?

    private var selected: WovenleafReaderPreferences.FontFamilyChoice = .literary
    private var palette = ReaderPalette(theme: .paper)
    private var buttons: [WovenleafReaderPreferences.FontFamilyChoice: UIButton] = [:]

    override init(frame: CGRect) {
        super.init(frame: frame)
        axis = .vertical
        spacing = 7
        let choices = WovenleafReaderPreferences.FontFamilyChoice.allCases
        for start in stride(from: 0, to: choices.count, by: 2) {
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 7
            row.distribution = .fillEqually
            for choice in choices[start ..< min(start + 2, choices.count)] {
                let button = UIButton(type: .custom)
                button.tag = choices.firstIndex(of: choice) ?? 0
                button.setTitle("Ag   \(choice.label)", for: .normal)
                button.titleLabel?.font = sampleFont(for: choice)
                button.titleLabel?.adjustsFontForContentSizeCategory = true
                button.contentHorizontalAlignment = .leading
                button.contentEdgeInsets = UIEdgeInsets(top: 12, left: 13, bottom: 12, right: 13)
                button.layer.cornerRadius = 10
                button.layer.borderWidth = 0.5
                button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
                button.accessibilityLabel = "\(choice.label) typeface"
                button.addTarget(self, action: #selector(chosen(_:)), for: .touchUpInside)
                buttons[choice] = button
                row.addArrangedSubview(button)
            }
            addArrangedSubview(row)
        }
        refresh()
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func select(_ choice: WovenleafReaderPreferences.FontFamilyChoice) {
        selected = choice
        refresh()
    }

    func applyPalette(_ palette: ReaderPalette) {
        self.palette = palette
        refresh()
    }

    @objc private func chosen(_ sender: UIButton) {
        guard WovenleafReaderPreferences.FontFamilyChoice.allCases.indices.contains(sender.tag) else { return }
        let choice = WovenleafReaderPreferences.FontFamilyChoice.allCases[sender.tag]
        selected = choice
        refresh()
        onSelect?(choice)
    }

    private func refresh() {
        buttons.forEach { choice, button in
            let isSelected = choice == selected
            button.backgroundColor = isSelected ? palette.ink : palette.raised
            button.layer.borderColor = (isSelected ? palette.ink : palette.rule).cgColor
            button.setTitleColor(isSelected ? palette.inverseInk : palette.ink, for: .normal)
            button.accessibilityTraits = isSelected ? [.button, .selected] : .button
        }
    }

    private func sampleFont(for choice: WovenleafReaderPreferences.FontFamilyChoice) -> UIFont {
        switch choice {
        case .literary: return UIFont(name: "IowanOldStyle-Roman", size: 15) ?? .preferredFont(forTextStyle: .body)
        case .sans: return UIFont(name: "AvenirNext-Medium", size: 14) ?? .preferredFont(forTextStyle: .body)
        case .mono: return .monospacedSystemFont(ofSize: 13, weight: .regular)
        case .accessible: return .systemFont(ofSize: 14, weight: .semibold)
        }
    }
}

final class PaperTextureView: UIView {
    var theme: WovenleafReaderPreferences.ThemeChoice = .paper {
        didSet { setNeedsDisplay() }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard !UIAccessibility.isDarkerSystemColorsEnabled, let context = UIGraphicsGetCurrentContext() else {
            return
        }
        let light = theme == .graphite
        context.setStrokeColor((light ? UIColor.white : UIColor.black).withAlphaComponent(0.018).cgColor)
        context.setLineWidth(0.5 / UIScreen.main.scale)
        for y in stride(from: 3.0, through: Double(rect.maxY), by: 8.0) {
            let offset = CGFloat(Int(y) % 3) * 0.35
            context.move(to: CGPoint(x: rect.minX, y: CGFloat(y) + offset))
            context.addLine(to: CGPoint(x: rect.maxX, y: CGFloat(y) + offset))
        }
        context.strokePath()

        context.setFillColor((light ? UIColor.white : UIColor.black).withAlphaComponent(0.026).cgColor)
        let columns = max(1, Int(rect.width / 29))
        let rows = max(1, Int(rect.height / 31))
        for row in 0 ... rows {
            for column in 0 ... columns where (row * 7 + column * 11) % 9 == 0 {
                let x = CGFloat(column * 29 + (row * 13) % 23)
                let y = CGFloat(row * 31 + (column * 17) % 19)
                context.fillEllipse(in: CGRect(x: x, y: y, width: 0.7, height: 0.7))
            }
        }
    }
}

extension UIColor {
    convenience init(readerHex: String) {
        let value = Int(readerHex.dropFirst(), radix: 16) ?? 0
        self.init(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

private extension Double {
    func rounded(step: Double) -> Double { (self / step).rounded() * step }
}
