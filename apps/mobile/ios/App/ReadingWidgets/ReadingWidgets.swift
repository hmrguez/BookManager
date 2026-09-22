import SwiftUI
import WidgetKit
import AppIntents

private let shared = UserDefaults(suiteName: "group.com.hmrguez.wovenleaf")!

struct ReadingBook: Decodable {
    let id: String
    let lastActivity: String
    let cover: String?
    let title: String
    let author: String
    let progress: Int
    let progressLabel: String
    let url: String
}
struct ReadingSnapshot: Decodable {
    let books: [ReadingBook]
    let days: [String]
    static let empty = ReadingSnapshot(books: [], days: [])
    static func load() -> ReadingSnapshot {
        guard let raw = shared.string(forKey: "reading-widget-snapshot"), let data = raw.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(ReadingSnapshot.self, from: data) else { return .empty }
        return snapshot
    }
    var latest: String { (books.first?.id ?? "") + (books.first?.lastActivity ?? "") }
    var index: Int {
        guard !books.isEmpty else { return 0 }
        guard shared.string(forKey: "widget-latest-book") == latest else { return 0 }
        return (shared.integer(forKey: "widget-book-index") % books.count + books.count) % books.count
    }
    func streak(at date: Date) -> (count: Int, today: Bool) {
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let recorded = Set(days)
        let today = recorded.contains(formatter.string(from: date))
        var cursor = calendar.startOfDay(for: date)
        if !today { cursor = calendar.date(byAdding: .day, value: -1, to: cursor)! }
        var count = 0
        while recorded.contains(formatter.string(from: cursor)) {
            count += 1
            cursor = calendar.date(byAdding: .day, value: -1, to: cursor)!
        }
        return (count, today)
    }
}
struct ReadingEntry: TimelineEntry { let date: Date; let snapshot: ReadingSnapshot }
struct ReadingProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReadingEntry { ReadingEntry(date: .now, snapshot: .empty) }
    func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
        completion(ReadingEntry(date: .now, snapshot: .load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
        let now = Date()
        let snapshot = ReadingSnapshot.load()
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: now))!
        let dayAfter = Calendar.current.date(byAdding: .day, value: 1, to: tomorrow)!
        completion(Timeline(entries: [ReadingEntry(date: now, snapshot: snapshot), ReadingEntry(date: tomorrow, snapshot: snapshot), ReadingEntry(date: dayAfter, snapshot: snapshot)], policy: .after(dayAfter)))
    }
}
struct ChangeReadingBook: AppIntent {
    static var title: LocalizedStringResource = "Change reading book"
    static var openAppWhenRun = false
    @Parameter(title: "Direction") var direction: Int
    init() { direction = 1 }
    init(direction: Int) { self.direction = direction }
    func perform() async throws -> some IntentResult {
        let snapshot = ReadingSnapshot.load()
        guard !snapshot.books.isEmpty else { return .result() }
        shared.set((snapshot.index + direction + snapshot.books.count) % snapshot.books.count, forKey: "widget-book-index")
        shared.set(snapshot.latest, forKey: "widget-latest-book")
        WidgetCenter.shared.reloadTimelines(ofKind: "WovenleafReading")
        return .result()
    }
}
struct Paper: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content.foregroundStyle(scheme == .dark ? Color(red: 0.988, green: 0.980, blue: 0.957) : Color(red: 0.137, green: 0.133, blue: 0.118))
            .containerBackground(for: .widget) {
                scheme == .dark ? Color(red: 0.110, green: 0.145, blue: 0.129) : Color(red: 0.957, green: 0.941, blue: 0.902)
            }
    }
}
struct ReadingView: View {
    let entry: ReadingEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        let snapshot = entry.snapshot
        VStack(alignment: .leading, spacing: 4) {
            if !snapshot.books.isEmpty {
                let book = snapshot.books[snapshot.index]
                HStack(alignment: .center, spacing: 12) {
                    if family != .systemSmall {
                        if let raw = book.cover, let data = Data(base64Encoded: raw), let image = UIImage(data: data) {
                            Image(uiImage: image).resizable().scaledToFit().frame(width: 44, height: 66).clipShape(RoundedRectangle(cornerRadius: 3)).accessibilityHidden(true)
                        } else {
                            Image(systemName: "book.closed").font(.system(size: 38, weight: .light)).frame(width: 44, height: 66).accessibilityHidden(true)
                        }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(book.title).font(.system(.subheadline, design: .serif)).lineLimit(2)
                        Text(book.author).font(.caption2).lineLimit(1)
                        if family == .systemSmall { Spacer(minLength: 4) }
                        Link(destination: URL(string: book.url)!) {
                            Text(book.progressLabel).font(.system(.callout, design: .serif)).frame(maxWidth: .infinity, alignment: .leading)
                        }.accessibilityLabel("Record progress, \(book.progressLabel)")
                        ProgressView(value: Double(book.progress), total: 100).tint(.primary).accessibilityHidden(true)
                    }
                }
                if snapshot.books.count > 1 && family != .systemSmall {
                    HStack {
                        Button(intent: ChangeReadingBook(direction: -1)) { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel("Previous book")
                        Spacer()
                        Text("\(snapshot.index + 1) of \(snapshot.books.count)").font(.caption)
                        Spacer()
                        Button(intent: ChangeReadingBook(direction: 1)) { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.accessibilityLabel("Next book")
                    }.buttonStyle(.plain)
                }
            } else {
                Image(systemName: "book.closed").font(.title)
                Text("Your next page awaits").font(.system(.headline, design: .serif))
                Text("Start a book in Wovenleaf").font(.caption)
            }
        }
        .widgetURL(URL(string: snapshot.books.isEmpty ? "wovenleaf://widgets/reading" : snapshot.books[snapshot.index].url))
        .modifier(Paper())
    }
}
struct StreakView: View {
    let entry: ReadingEntry
    var body: some View {
        let streak = entry.snapshot.streak(at: entry.date)
        VStack(alignment: .leading, spacing: 5) {
            Text("Reading streak").font(.caption)
            Spacer(minLength: 0)
            Text("\(streak.count)").font(.system(size: 52, weight: .regular, design: .serif)).minimumScaleFactor(0.6).lineLimit(1)
            Text(streak.count == 1 ? "day of reading" : "days of reading").font(.system(.subheadline, design: .serif))
            Spacer(minLength: 0)
            Text(streak.today ? "Read today ✓" : streak.count > 0 ? "Keep it going today" : "Every page is a beginning").font(.caption2)
        }.widgetURL(URL(string: "wovenleaf://widgets/streak")).modifier(Paper())
    }
}
struct ReadingWidget: Widget {
    let kind = "WovenleafReading"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ReadingProvider()) { ReadingView(entry: $0) }
            .configurationDisplayName("Reading")
            .description("Your current book. Tap its progress to record your next page.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
struct StreakWidget: Widget {
    let kind = "WovenleafStreak"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ReadingProvider()) { StreakView(entry: $0) }
            .configurationDisplayName("Reading streak")
            .description("Any progress, in any book, keeps your reading streak going.")
            .supportedFamilies([.systemSmall])
    }
}
@main struct ReadingWidgets: WidgetBundle {
    var body: some Widget { ReadingWidget(); StreakWidget() }
}
