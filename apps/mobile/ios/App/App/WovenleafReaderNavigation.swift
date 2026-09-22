import ReadiumShared
import UIKit

struct ReaderBookmarkState {
    let id: String
    let assetId: String
    let assetFingerprint: String
    let locator: Locator
    let createdAt: String
    var updatedAt: String
}

struct ReaderNavigationState {
    struct TocState {
        let assetFingerprint: String
        let locator: Locator
    }

    let bookId: String
    let editionId: String
    var toc: TocState?
    var bookmarks: [ReaderBookmarkState]
    var updatedAt: String

    init?(object: [String: Any]?) {
        guard
            let object,
            (object["version"] as? NSNumber)?.intValue == 1,
            let bookId = object["bookId"] as? String,
            let editionId = object["editionId"] as? String,
            let updatedAt = object["updatedAt"] as? String,
            let bookmarkObjects = object["bookmarks"] as? [[String: Any]]
        else { return nil }

        self.bookId = bookId
        self.editionId = editionId
        self.updatedAt = updatedAt
        bookmarks = bookmarkObjects.compactMap { value in
            guard
                let id = value["id"] as? String,
                let assetId = value["assetId"] as? String,
                let assetFingerprint = value["assetFingerprint"] as? String,
                let locatorObject = value["locator"] as? [String: Any],
                let locator = readerLocator(from: locatorObject),
                let createdAt = value["createdAt"] as? String,
                let updatedAt = value["updatedAt"] as? String
            else { return nil }
            return ReaderBookmarkState(
                id: id,
                assetId: assetId,
                assetFingerprint: assetFingerprint,
                locator: locator,
                createdAt: createdAt,
                updatedAt: updatedAt
            )
        }
        if
            let tocObject = object["toc"] as? [String: Any],
            let assetFingerprint = tocObject["assetFingerprint"] as? String,
            let locatorObject = tocObject["locator"] as? [String: Any],
            let locator = readerLocator(from: locatorObject)
        {
            toc = TocState(assetFingerprint: assetFingerprint, locator: locator)
        }
    }

    static func empty(context: ReaderContext) -> ReaderNavigationState {
        ReaderNavigationState(
            bookId: context.bookId,
            editionId: context.editionId,
            toc: nil,
            bookmarks: [],
            updatedAt: "1970-01-01T00:00:00.000Z"
        )
    }

    private init(
        bookId: String,
        editionId: String,
        toc: TocState?,
        bookmarks: [ReaderBookmarkState],
        updatedAt: String
    ) {
        self.bookId = bookId
        self.editionId = editionId
        self.toc = toc
        self.bookmarks = bookmarks
        self.updatedAt = updatedAt
    }
}

@MainActor
final class ReaderChapterRailView: UIView {
    static let gutterWidth: CGFloat = 26

    var onNavigate: ((Link) -> Void)?

    private struct Entry {
        let link: Link
        let depth: Int
    }

    private var entries: [Entry] = []
    private var activeIndex = 0
    private var previewIndex: Int?
    private var pulseIndex: Int?
    private var showsAllMarkers = false
    private var scrubY: CGFloat?
    private var palette = ReaderPalette(theme: .paper)
    private var hideWorkItem: DispatchWorkItem?
    private let railWidth = ReaderChapterRailView.gutterWidth
    private let maxVisibleMarkers = 7
    private let markerSpacing: CGFloat = 10

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        clipsToBounds = false
        isAccessibilityElement = true
        accessibilityLabel = "Chapter rail"
        accessibilityTraits = [.adjustable]

        let hover = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
        addGestureRecognizer(hover)
        let press = UILongPressGestureRecognizer(target: self, action: #selector(pressed(_:)))
        press.minimumPressDuration = 0
        press.allowableMovement = .greatestFiniteMagnitude
        addGestureRecognizer(press)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        point.x <= railWidth || (previewIndex != nil && previewRect.contains(point))
    }

    func setLinks(_ links: [Link]) {
        entries = flatten(links)
        activeIndex = min(activeIndex, max(0, entries.count - 1))
        refreshAccessibilityValue()
        setNeedsDisplay()
    }

    func updateActive(locator: Locator?) {
        guard let locator, let match = matchingIndex(for: locator) else { return }
        if activeIndex != match {
            activeIndex = match
            refreshAccessibilityValue()
            setNeedsDisplay()
        }
    }

    func applyPalette(_ palette: ReaderPalette) {
        self.palette = palette
        setNeedsDisplay()
    }

    func revealActiveMomentarily() {
        guard entries.indices.contains(activeIndex) else { return }
        hideWorkItem?.cancel()
        pulseIndex = activeIndex
        setNeedsDisplay()
        let work = DispatchWorkItem { [weak self] in
            self?.pulseIndex = nil
            self?.setNeedsDisplay()
        }
        hideWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
    }

    override func accessibilityIncrement() {
        guard !entries.isEmpty else { return }
        activeIndex = min(entries.count - 1, activeIndex + 1)
        onNavigate?(entries[activeIndex].link)
        reveal(activeIndex, duration: 1.1)
    }

    override func accessibilityDecrement() {
        guard !entries.isEmpty else { return }
        activeIndex = max(0, activeIndex - 1)
        onNavigate?(entries[activeIndex].link)
        reveal(activeIndex, duration: 1.1)
    }

    override func accessibilityActivate() -> Bool {
        guard entries.indices.contains(activeIndex) else { return false }
        onNavigate?(entries[activeIndex].link)
        reveal(activeIndex, duration: 1.1)
        return true
    }

    override func draw(_ rect: CGRect) {
        guard !entries.isEmpty, let context = UIGraphicsGetCurrentContext() else { return }
        let visible = visibleIndices
        let previewPosition = scrubY.map {
            min(CGFloat(entries.count - 1), max(0, ($0 - markerBand.minY) / spacing(for: visible)))
        } ?? (previewIndex ?? pulseIndex).map { CGFloat($0) }
        for index in visible {
            let y = markerY(for: index, visible: visible)
            let active = index == activeIndex
            let emphasized = index == previewIndex || index == pulseIndex
            let activeExtension = 9 * markerInfluence(index, focus: CGFloat(activeIndex))
            let previewExtension = previewPosition.map { 6 * markerInfluence(index, focus: $0) } ?? 0
            let width: CGFloat = 9 + max(activeExtension, previewExtension)
            context.setStrokeColor((active ? palette.ink : palette.secondaryInk).withAlphaComponent(active ? 0.95 : emphasized ? 0.65 : 0.32).cgColor)
            context.setLineWidth(active ? 2.2 : 1.2)
            context.setLineCap(.round)
            context.move(to: CGPoint(x: 4, y: y))
            context.addLine(to: CGPoint(x: 4 + width, y: y))
            context.strokePath()
        }
        if let previewIndex { drawPreview(index: previewIndex, context: context) }
    }

    private func markerInfluence(_ index: Int, focus: CGFloat) -> CGFloat {
        // Smoothly taper to the resting length over three neighboring chapters.
        let proximity = max(0, 1 - abs(CGFloat(index) - focus) / 3)
        return proximity * proximity * (3 - 2 * proximity)
    }

    private var markerBand: CGRect {
        let visible = visibleIndices
        let markerHeight = CGFloat(max(0, visible.count - 1)) * spacing(for: visible)
        return CGRect(
            x: 0,
            y: bounds.midY - markerHeight / 2,
            width: railWidth,
            height: max(1, markerHeight)
        )
    }

    private var previewRect: CGRect {
        let x = Self.gutterWidth + 8
        let width = min(330, max(210, bounds.width - x - 14))
        return CGRect(x: x, y: max(16, min(bounds.height - 148, previewAnchorY - 66)), width: width, height: 132)
    }

    private var previewAnchorY: CGFloat {
        guard let previewIndex, !entries.isEmpty else { return bounds.midY }
        return markerY(for: previewIndex, visible: visibleIndices)
    }

    private func drawPreview(index: Int, context: CGContext) {
        let card = UIBezierPath(roundedRect: previewRect, cornerRadius: 17)
        palette.raised.setFill()
        card.fill()
        palette.rule.withAlphaComponent(0.72).setStroke()
        card.lineWidth = 0.5
        card.stroke()

        let visible = [index - 1, index, index + 1].filter(entries.indices.contains)
        var y = previewRect.minY + 17
        for entryIndex in visible {
            let isFocused = entryIndex == index
            let rawTitle = entries[entryIndex].link.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let title = rawTitle.isEmpty ? "Untitled section" : rawTitle
            let font = isFocused
                ? UIFont.preferredFont(forTextStyle: .headline)
                : UIFont.preferredFont(forTextStyle: .subheadline)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: isFocused ? palette.ink : palette.secondaryInk.withAlphaComponent(0.72),
            ]
            let textRect = CGRect(
                x: previewRect.minX + 17 + CGFloat(min(entries[entryIndex].depth, 3) * 8),
                y: y,
                width: previewRect.width - 34,
                height: isFocused ? 43 : 27
            )
            (title as NSString).draw(
                with: textRect,
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                attributes: attributes,
                context: nil
            )
            y += isFocused ? 48 : 31
        }
    }

    @objc private func hovered(_ recognizer: UIHoverGestureRecognizer) {
        switch recognizer.state {
        case .began, .changed:
            guard recognizer.location(in: self).x <= railWidth else { return }
            previewIndex = nearestIndex(to: recognizer.location(in: self).y)
            hideWorkItem?.cancel()
            setNeedsDisplay()
        case .ended, .cancelled:
            previewIndex = nil
            setNeedsDisplay()
        default:
            break
        }
    }

    @objc private func pressed(_ recognizer: UILongPressGestureRecognizer) {
        let point = recognizer.location(in: self)
        if recognizer.state == .began || recognizer.state == .changed {
            guard point.x <= railWidth else { return }
            showsAllMarkers = true
            scrubY = point.y
            hideWorkItem?.cancel()
            previewIndex = nearestIndex(to: point.y)
            setNeedsDisplay()
        } else if recognizer.state == .ended {
            let index = point.x <= railWidth ? nearestIndex(to: point.y) : nil
            showsAllMarkers = false
            scrubY = nil
            guard let index else {
                previewIndex = nil
                setNeedsDisplay()
                return
            }
            activeIndex = index
            onNavigate?(entries[index].link)
            reveal(index, duration: 1.2)
        } else if recognizer.state == .cancelled || recognizer.state == .failed {
            showsAllMarkers = false
            scrubY = nil
            previewIndex = nil
            setNeedsDisplay()
        }
    }

    private func reveal(_ index: Int, duration: TimeInterval) {
        guard entries.indices.contains(index) else { return }
        hideWorkItem?.cancel()
        pulseIndex = nil
        previewIndex = index
        refreshAccessibilityValue()
        setNeedsDisplay()
        let work = DispatchWorkItem { [weak self] in
            self?.previewIndex = nil
            self?.setNeedsDisplay()
        }
        hideWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + duration, execute: work)
    }

    private func nearestIndex(to y: CGFloat) -> Int? {
        let visible = visibleIndices
        return visible.min { left, right in
            abs(markerY(for: left, visible: visible) - y) < abs(markerY(for: right, visible: visible) - y)
        }
    }

    private var visibleIndices: [Int] {
        guard !entries.isEmpty else { return [] }
        if showsAllMarkers { return Array(entries.indices) }
        let count = min(maxVisibleMarkers, entries.count)
        let focus = previewIndex ?? activeIndex
        let unclampedStart = focus - count / 2
        let start = min(max(0, unclampedStart), entries.count - count)
        return Array(start..<(start + count))
    }

    private func markerY(for index: Int, visible: [Int]) -> CGFloat {
        guard let offset = visible.firstIndex(of: index), visible.count > 1 else { return bounds.midY }
        return markerBand.minY + CGFloat(offset) * spacing(for: visible)
    }

    private func spacing(for visible: [Int]) -> CGFloat {
        guard showsAllMarkers, visible.count > 1 else { return markerSpacing }
        return min(markerSpacing, max(1, bounds.height - 48) / CGFloat(visible.count - 1))
    }

    private func matchingIndex(for locator: Locator) -> Int? {
        let resource = locator.href.removingFragment().string
        let fragments = Set(
            locator.locations.fragments.map(normalizedFragment)
                + [locator.href.fragment].compactMap { $0 }.map(normalizedFragment)
        )
        let resourceMatches = entries.indices.filter {
            entries[$0].link.url().removingFragment().string == resource
        }
        guard !resourceMatches.isEmpty else { return nil }

        if let exact = resourceMatches.first(where: { index in
            guard let fragment = entries[index].link.url().fragment else { return false }
            return fragments.contains(normalizedFragment(fragment))
        }) {
            return exact
        }

        if resourceMatches.contains(activeIndex) {
            return activeIndex
        }
        return resourceMatches.first
    }

    private func normalizedFragment(_ fragment: String) -> String {
        let unprefixed = fragment.hasPrefix("#") ? String(fragment.dropFirst()) : fragment
        return unprefixed.removingPercentEncoding ?? unprefixed
    }

    private func refreshAccessibilityValue() {
        accessibilityValue = entries.indices.contains(activeIndex)
            ? entries[activeIndex].link.title ?? "Untitled section"
            : "No chapters"
    }

    private func flatten(_ links: [Link], depth: Int = 0) -> [Entry] {
        links.flatMap { [Entry(link: $0, depth: depth)] + flatten($0.children, depth: depth + 1) }
    }
}

func readerLocator(from object: [String: Any]) -> Locator? {
    guard
        JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object),
        let string = String(data: data, encoding: .utf8),
        let json = try? JSONValue(jsonString: string)
    else { return nil }
    return try? Locator(json: json, warnings: nil)
}

@MainActor
final class ReaderOutlineViewController: UIViewController {
    var onNavigateToLink: ((Link) -> Void)?
    var onNavigateToLocator: ((Locator) -> Void)?
    var onDeleteBookmark: ((ReaderBookmarkState) -> Void)?
    var onEditAnnotation: ((ReaderAnnotationRecord) -> Void)?
    var onDeleteAnnotation: ((ReaderAnnotationRecord) -> Void)?
    var onReviewAnnotation: ((ReaderAnnotationRecord) -> Void)?

    private struct TocEntry {
        let link: Link
        let depth: Int
    }

    private let publication: Publication
    private let currentLocator: Locator?
    private let selectedTocLocator: Locator?
    private var bookmarks: [ReaderBookmarkState]
    private var annotations: [ReaderAnnotationRecord]
    private let palette: ReaderPalette
    private var tocEntries: [TocEntry] = []
    private var searchResults: [Locator] = []
    private var searchTask: Task<Void, Never>?
    private let mode = UISegmentedControl(items: ["Contents", "Bookmarks", "Notes"])
    private let tableView = UITableView(frame: .zero, style: .plain)
    private let statusLabel = UILabel()
    private let searchController = UISearchController(searchResultsController: nil)

    init(
        publication: Publication,
        currentLocator: Locator?,
        selectedTocLocator: Locator?,
        bookmarks: [ReaderBookmarkState],
        annotations: [ReaderAnnotationRecord],
        palette: ReaderPalette
    ) {
        self.publication = publication
        self.currentLocator = currentLocator
        self.selectedTocLocator = selectedTocLocator
        self.bookmarks = bookmarks
        self.annotations = annotations.filter { !$0.isDeleted }.sorted {
            $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt
        }
        self.palette = palette
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Navigate"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: self,
            action: #selector(close)
        )
        searchController.searchResultsUpdater = self
        searchController.obscuresBackgroundDuringPresentation = false
        searchController.searchBar.placeholder = publication.isSearchable
            ? "Search in this book"
            : "Search unavailable for this book"
        searchController.searchBar.isUserInteractionEnabled = publication.isSearchable
        searchController.searchBar.accessibilityLabel = "Search within book"
        navigationItem.searchController = searchController
        navigationItem.hidesSearchBarWhenScrolling = false
        definesPresentationContext = true

        mode.selectedSegmentIndex = 0
        mode.addTarget(self, action: #selector(modeChanged), for: .valueChanged)
        mode.translatesAutoresizingMaskIntoConstraints = false
        mode.accessibilityLabel = "Navigation section"

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.dataSource = self
        tableView.delegate = self
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 58
        tableView.backgroundColor = palette.page
        tableView.separatorColor = palette.rule
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "reader-navigation-row")

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.textColor = palette.secondaryInk
        statusLabel.text = "Loading contents…"

        view.backgroundColor = palette.page
        view.addSubview(mode)
        view.addSubview(tableView)
        view.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            mode.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            mode.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            mode.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            tableView.topAnchor.constraint(equalTo: mode.bottomAnchor, constant: 10),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: tableView.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
        applyPalette()
        loadTableOfContents()
    }

    deinit { searchTask?.cancel() }

    private var isSearching: Bool {
        !(searchController.searchBar.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var rowCount: Int {
        if isSearching { return searchResults.count }
        switch mode.selectedSegmentIndex {
        case 0: return tocEntries.count
        case 1: return bookmarks.count
        default: return annotations.count
        }
    }

    private func loadTableOfContents() {
        Task { [weak self] in
            guard let self else { return }
            let links = (try? await publication.tableOfContents().get()) ?? []
            tocEntries = flatten(links)
            refreshStatus()
            tableView.reloadData()
        }
    }

    private func flatten(_ links: [Link], depth: Int = 0) -> [TocEntry] {
        links.flatMap { link in
            [TocEntry(link: link, depth: depth)] + flatten(link.children, depth: depth + 1)
        }
    }

    private func search(_ rawQuery: String) {
        searchTask?.cancel()
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            searchResults = []
            refreshStatus()
            tableView.reloadData()
            return
        }
        statusLabel.text = "Searching…"
        statusLabel.isHidden = false
        tableView.reloadData()
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard let self, !Task.isCancelled else { return }
            guard let iterator = try? await publication.search(query: query).get() else {
                searchResults = []
                statusLabel.text = "Search is unavailable for this publication."
                tableView.reloadData()
                return
            }
            var results: [Locator] = []
            while !Task.isCancelled, results.count < 250 {
                guard let page = try? await iterator.next().get() else { break }
                results.append(contentsOf: page.locators.prefix(250 - results.count))
            }
            guard !Task.isCancelled else { return }
            searchResults = results
            refreshStatus()
            tableView.reloadData()
        }
    }

    private func refreshStatus() {
        if isSearching {
            statusLabel.text = searchResults.isEmpty ? "No passages found." : nil
            statusLabel.isHidden = !searchResults.isEmpty
        } else if mode.selectedSegmentIndex == 0 {
            statusLabel.text = tocEntries.isEmpty
                ? "This book does not include a usable table of contents. You can still search or use the scrubber."
                : nil
            statusLabel.isHidden = !tocEntries.isEmpty
        } else if mode.selectedSegmentIndex == 1 {
            statusLabel.text = bookmarks.isEmpty
                ? "No bookmarks yet. Use the ribbon in the reader to keep a passage."
                : nil
            statusLabel.isHidden = !bookmarks.isEmpty
        } else {
            statusLabel.text = annotations.isEmpty
                ? "No highlights or passage notes yet. Select text in the reader to begin."
                : nil
            statusLabel.isHidden = !annotations.isEmpty
        }
    }

    private func applyPalette() {
        navigationController?.navigationBar.tintColor = palette.ink
        mode.selectedSegmentTintColor = palette.ink
        mode.setTitleTextAttributes([.foregroundColor: palette.ink], for: .normal)
        mode.setTitleTextAttributes([.foregroundColor: palette.inverseInk], for: .selected)
        searchController.searchBar.tintColor = palette.ink
    }

    private func configure(_ cell: UITableViewCell, title: String, detail: String?, depth: Int = 0) {
        var content = cell.defaultContentConfiguration()
        content.text = title
        content.secondaryText = detail
        content.textProperties.font = .preferredFont(forTextStyle: depth == 0 ? .headline : .body)
        content.textProperties.color = palette.ink
        content.secondaryTextProperties.font = .preferredFont(forTextStyle: .caption1)
        content.secondaryTextProperties.color = palette.secondaryInk
        content.directionalLayoutMargins.leading = CGFloat(18 + min(depth, 5) * 18)
        cell.contentConfiguration = content
        cell.backgroundColor = palette.page
        cell.tintColor = palette.ink
        cell.accessoryType = .disclosureIndicator
    }

    private func searchContext(_ locator: Locator) -> String {
        let text = locator.text.sanitized()
        let passage = [text.before, text.highlight, text.after]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return passage.isEmpty ? "Open this result" : passage
    }

    private func bookmarkDetail(_ bookmark: ReaderBookmarkState) -> String {
        let percent = bookmark.locator.locations.totalProgression.map {
            "\(Int(($0 * 100).rounded()))%"
        }
        let passage = bookmark.locator.text.highlight?.trimmingCharacters(in: .whitespacesAndNewlines)
        return [percent, passage].compactMap { $0 }.joined(separator: " · ")
    }

    private func annotationDetail(_ annotation: ReaderAnnotationRecord) -> String {
        let review = annotation.anchorStatus == .review ? "Needs review" : nil
        let chapter = annotation.chapter
        let quote = annotation.quote.replacingOccurrences(of: "\n", with: " ")
        let note = annotation.note.trimmingCharacters(in: .whitespacesAndNewlines)
        return [review, chapter, quote, note.isEmpty ? nil : note]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    @objc private func close() { dismiss(animated: !UIAccessibility.isReduceMotionEnabled) }

    @objc private func modeChanged() {
        refreshStatus()
        tableView.reloadData()
    }
}

extension ReaderOutlineViewController: UISearchResultsUpdating {
    func updateSearchResults(for searchController: UISearchController) {
        search(searchController.searchBar.text ?? "")
    }
}

extension ReaderOutlineViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rowCount }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "reader-navigation-row", for: indexPath)
        if isSearching {
            let locator = searchResults[indexPath.row]
            configure(
                cell,
                title: locator.title ?? "Passage",
                detail: searchContext(locator)
            )
            cell.accessibilityLabel = "Search result, \(locator.title ?? "passage"), \(searchContext(locator))"
        } else if mode.selectedSegmentIndex == 0 {
            let entry = tocEntries[indexPath.row]
            configure(cell, title: entry.link.title ?? "Untitled section", detail: nil, depth: entry.depth)
            let activeHref = selectedTocLocator?.href ?? currentLocator?.href
            cell.accessoryType = entry.link.url().string == activeHref?.string ? .checkmark : .disclosureIndicator
            cell.accessibilityLabel = "Level \(entry.depth + 1), \(entry.link.title ?? "Untitled section")"
        } else if mode.selectedSegmentIndex == 1 {
            let bookmark = bookmarks[indexPath.row]
            configure(
                cell,
                title: bookmark.locator.title ?? "Saved passage",
                detail: bookmarkDetail(bookmark)
            )
            cell.accessibilityLabel = "Bookmark, \(bookmark.locator.title ?? "saved passage"), \(bookmarkDetail(bookmark))"
        } else {
            let annotation = annotations[indexPath.row]
            configure(
                cell,
                title: annotation.anchorStatus == .review ? "Review · \(annotation.chapter ?? "Passage")" : (annotation.chapter ?? "Highlighted passage"),
                detail: annotationDetail(annotation)
            )
            cell.accessoryType = annotation.anchorStatus == .review ? .detailButton : .disclosureIndicator
            cell.accessibilityLabel = "Annotation, \(annotationDetail(annotation))"
        }
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if isSearching {
            onNavigateToLocator?(searchResults[indexPath.row])
        } else if mode.selectedSegmentIndex == 0 {
            onNavigateToLink?(tocEntries[indexPath.row].link)
        } else if mode.selectedSegmentIndex == 1 {
            onNavigateToLocator?(bookmarks[indexPath.row].locator)
        } else {
            let annotation = annotations[indexPath.row]
            if annotation.anchorStatus == .review {
                onReviewAnnotation?(annotation)
            } else {
                onNavigateToLocator?(annotation.locator)
            }
        }
        dismiss(animated: !UIAccessibility.isReduceMotionEnabled)
    }

    func tableView(
        _ tableView: UITableView,
        trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath
    ) -> UISwipeActionsConfiguration? {
        guard !isSearching, mode.selectedSegmentIndex != 0 else { return nil }
        if mode.selectedSegmentIndex == 1 {
            let bookmark = bookmarks[indexPath.row]
            let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
                guard let self else { return done(false) }
                bookmarks.remove(at: indexPath.row)
                onDeleteBookmark?(bookmark)
                tableView.deleteRows(at: [indexPath], with: .automatic)
                refreshStatus()
                done(true)
            }
            delete.accessibilityLabel = "Delete bookmark"
            return UISwipeActionsConfiguration(actions: [delete])
        }
        let annotation = annotations[indexPath.row]
        let delete = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
            guard let self else { return done(false) }
            annotations.remove(at: indexPath.row)
            onDeleteAnnotation?(annotation)
            tableView.deleteRows(at: [indexPath], with: .automatic)
            refreshStatus()
            done(true)
        }
        delete.accessibilityLabel = "Delete annotation"
        let edit = UIContextualAction(style: .normal, title: "Edit") { [weak self] _, _, done in
            self?.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) {
                self?.onEditAnnotation?(annotation)
            }
            done(true)
        }
        edit.backgroundColor = palette.secondaryInk
        edit.accessibilityLabel = "Edit annotation"
        return UISwipeActionsConfiguration(actions: [delete, edit])
    }
}

@MainActor
final class ReaderFootnoteViewController: UIViewController {
    private let note: String
    private let palette: ReaderPalette

    init(content: String, palette: ReaderPalette) {
        note = content.readerPlainTextFromHTML
        self.palette = palette
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Note"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Return to passage",
            style: .done,
            target: self,
            action: #selector(close)
        )
        let textView = UITextView()
        textView.translatesAutoresizingMaskIntoConstraints = false
        textView.isEditable = false
        textView.isScrollEnabled = true
        textView.adjustsFontForContentSizeCategory = true
        textView.font = .preferredFont(forTextStyle: .body)
        textView.text = note
        textView.textColor = palette.ink
        textView.backgroundColor = palette.page
        textView.textContainerInset = UIEdgeInsets(top: 24, left: 20, bottom: 32, right: 20)
        view.backgroundColor = palette.page
        view.addSubview(textView)
        NSLayoutConstraint.activate([
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            textView.topAnchor.constraint(equalTo: view.topAnchor),
            textView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    @objc private func close() { dismiss(animated: !UIAccessibility.isReduceMotionEnabled) }
}

@MainActor
final class ReaderImageViewController: UIViewController, UIScrollViewDelegate {
    private let publication: Publication
    private let image: ImageContentElement
    private let palette: ReaderPalette
    private let scrollView = UIScrollView()
    private let imageView = UIImageView()
    private let statusLabel = UILabel()

    init(publication: Publication, image: ImageContentElement, palette: ReaderPalette) {
        self.publication = publication
        self.image = image
        self.palette = palette
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = image.caption ?? "Image detail"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: self,
            action: #selector(close)
        )
        view.backgroundColor = palette.page
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 5
        scrollView.delegate = self
        scrollView.accessibilityLabel = "Zoomable book image"
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFit
        imageView.accessibilityLabel = image.accessibilityLabel ?? image.caption ?? "Book image"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "Loading image…"
        statusLabel.textColor = palette.secondaryInk
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        scrollView.addSubview(imageView)
        view.addSubview(scrollView)
        view.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            imageView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            imageView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            imageView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
            imageView.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(toggleZoom(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)
        Task { [weak self] in await self?.loadImage() }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    private func loadImage() async {
        guard
            let resource = publication.get(image.embeddedLink),
            let data = try? await resource.read().get(),
            let loaded = UIImage(data: data)
        else {
            statusLabel.text = "This image cannot be magnified safely."
            return
        }
        imageView.image = loaded
        statusLabel.isHidden = true
    }

    @objc private func toggleZoom(_ recognizer: UITapGestureRecognizer) {
        if scrollView.zoomScale > 1 {
            scrollView.setZoomScale(1, animated: !UIAccessibility.isReduceMotionEnabled)
        } else {
            let point = recognizer.location(in: imageView)
            let size = CGSize(width: scrollView.bounds.width / 2.5, height: scrollView.bounds.height / 2.5)
            scrollView.zoom(to: CGRect(
                x: point.x - size.width / 2,
                y: point.y - size.height / 2,
                width: size.width,
                height: size.height
            ), animated: !UIAccessibility.isReduceMotionEnabled)
        }
    }

    @objc private func close() { dismiss(animated: !UIAccessibility.isReduceMotionEnabled) }
}

private extension String {
    var readerPlainTextFromHTML: String {
        guard let data = data(using: .utf8) else { return self }
        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue,
        ]
        return ((try? NSAttributedString(data: data, options: options, documentAttributes: nil))?.string ?? self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
