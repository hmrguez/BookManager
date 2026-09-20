import AVFoundation
import Capacitor
import CryptoKit
import Foundation
import MediaPlayer
import SQLite3
import UIKit

private let playbackBridgeVersion = 1
private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

@objc(WovenleafPlaybackPlugin)
final class WovenleafPlaybackPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafPlaybackPlugin"
    let jsName = "WovenleafPlayback"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekToAbsolute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekBy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nextChapter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "previousChapter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSleepTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSleepTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "adoptPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainJournal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeJournal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSystemSurfacePrivacy", returnType: CAPPluginReturnPromise),
    ]

    private let engine = WovenleafPlaybackEngine.shared

    override func load() {
        Task { @MainActor in engine.observer = self }
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        call.resolve(engine.capabilities)
    }

    @objc func loadQueue(_ call: CAPPluginCall) {
        guard let manifest = call.getObject("manifest"), let sources = call.getArray("sources") else {
            call.reject("The playback queue is invalid.", "QUEUE_INVALID")
            return
        }
        performCommand(call) {
            try self.engine.loadQueue(
                manifest: manifest,
                sources: sources,
                artwork: call.getObject("artwork")
            )
        }
    }

    @objc func play(_ call: CAPPluginCall) { performCommand(call) { try self.engine.play() } }
    @objc func pause(_ call: CAPPluginCall) { performCommand(call) { try self.engine.pause() } }
    @objc func stop(_ call: CAPPluginCall) { performCommand(call) { try self.engine.stop() } }

    @objc func seekToAbsolute(_ call: CAPPluginCall) {
        performCommand(call) { try self.engine.seek(to: max(0, call.getInt("positionMs") ?? 0), reason: "absolute-seek") }
    }

    @objc func seekBy(_ call: CAPPluginCall) {
        performCommand(call) { try self.engine.seek(to: self.engine.absolutePositionMs + (call.getInt("offsetMs") ?? 0), reason: "relative-seek") }
    }

    @objc func nextChapter(_ call: CAPPluginCall) {
        performCommand(call) { try self.engine.moveChapter(forward: true) }
    }

    @objc func previousChapter(_ call: CAPPluginCall) {
        performCommand(call) { try self.engine.moveChapter(forward: false) }
    }

    @objc func setRate(_ call: CAPPluginCall) {
        performCommand(call) { try self.engine.setRate(Float(call.getDouble("rate") ?? 1)) }
    }

    @objc func setSleepTimer(_ call: CAPPluginCall) {
        performCommand(call) {
            try self.engine.setSleepTimer(
                mode: call.getString("mode") ?? "duration",
                durationMs: call.getInt("durationMs")
            )
        }
    }

    @objc func cancelSleepTimer(_ call: CAPPluginCall) {
        performCommand(call) { self.engine.cancelSleepTimer() }
    }

    @objc func adoptPosition(_ call: CAPPluginCall) {
        performCommand(call) {
            try self.engine.adoptPosition(
                max(0, call.getInt("positionMs") ?? 0),
                provenance: call.getString("provenanceEventId") ?? "unknown"
            )
        }
    }

    @objc func getSnapshot(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(engine.snapshot) }
    }

    @objc func drainJournal(_ call: CAPPluginCall) {
        call.resolve(["events": engine.journal.events()])
    }

    @objc func acknowledgeJournal(_ call: CAPPluginCall) {
        engine.journal.acknowledge(ids: Set(call.getArray("ids", String.self) ?? []))
        call.resolve()
    }

    @objc func setSystemSurfacePrivacy(_ call: CAPPluginCall) {
        Task { @MainActor in
            engine.setSystemSurfacePreview(call.getBool("previewEnabled") ?? false)
            call.resolve(engine.snapshot)
        }
    }

    private func performCommand(_ call: CAPPluginCall, operation: @escaping () throws -> Void) {
        guard let commandId = call.getString("commandId"), let expectedRevision = call.getInt("expectedRevision") else {
            call.reject("The playback command is invalid.", "COMMAND_REJECTED")
            return
        }
        Task { @MainActor in
            do {
                let snapshot = try engine.applyCommand(
                    id: commandId,
                    expectedRevision: expectedRevision,
                    operation: operation
                )
                call.resolve(snapshot)
            } catch let error as PlaybackEngineError {
                call.reject(error.message, error.code)
            } catch {
                call.reject("Playback could not apply this command.", "COMMAND_REJECTED", error)
            }
        }
    }

    fileprivate func emitSnapshot(_ snapshot: JSObject) {
        notifyListeners("snapshotChanged", data: snapshot)
    }

    fileprivate func emitEventsAvailable(count: Int) {
        notifyListeners("eventsAvailable", data: ["count": count])
    }
}

private struct PlaybackEngineError: Error {
    let code: String
    let message: String
}

private struct PlaybackManifest: Codable {
    struct Metadata: Codable {
        let title: String
        let authors: [String]
        let narrators: [String]
        let series: String?
    }

    struct SurfaceMetadata: Codable {
        struct PrivateMetadata: Codable { let title: String; let subtitle: String }
        struct PreviewMetadata: Codable { let title: String; let contributor: String; let series: String? }
        let `private`: PrivateMetadata
        let preview: PreviewMetadata
    }

    struct Segment: Codable {
        let id: String
        let mediaType: String
        let durationMs: Int
        let absoluteStartMs: Int
        let absoluteEndMs: Int
        let fingerprint: String
        let playableCapability: String
    }

    struct Chapter: Codable {
        let key: String
        let title: String
        let segmentId: String
        let absoluteStartMs: Int
        let absoluteEndMs: Int
    }

    struct SkipIntervals: Codable { let forwardMs: Int; let backwardMs: Int }

    let schemaVersion: Int
    let queueId: String
    let editionId: String
    let assetId: String
    let fingerprint: String
    let displayMetadata: Metadata
    let systemSurfaceMetadata: SurfaceMetadata
    let segments: [Segment]
    let chapters: [Chapter]
    let initialAbsolutePositionMs: Int
    let rate: Float
    let skipIntervals: SkipIntervals
}

private struct PlaybackSource: Codable {
    let capability: String
    let uri: String
    let fingerprint: String
    let byteSize: Int
    let mediaType: String
}

private struct PlaybackArtwork: Codable {
    let uri: String
    let fingerprint: String
    let byteSize: Int
    let mediaType: String
}

func wovenleafPlaybackSuppressesInterfaceSounds() -> Bool {
    WovenleafPlaybackEngine.shared.interfaceSoundsAreSuppressed
}

private final class WovenleafPlaybackEngine: NSObject {
    static let shared = WovenleafPlaybackEngine()

    weak var observer: WovenleafPlaybackPlugin?
    let journal = PlaybackJournal()
    let player = AVQueuePlayer()
    let capabilities: JSObject = [
        "bridgeVersion": playbackBridgeVersion,
        "engine": "ios-avfoundation",
        "backgroundPlayback": true,
        "systemControls": true,
        "processRestoration": true,
        "systemLibrary": false,
        "airPlay": true,
        "cast": false,
        "routeSelection": true,
        "sleepTimer": true,
        "seek": true,
        "supportedMediaTypes": ["audio/mpeg", "audio/mp4"],
        "minimumRate": 0.5,
        "maximumRate": 3.0,
    ]

    private let engineEpoch = "ios-engine:\(UUID().uuidString.lowercased())"
    private var manifest: PlaybackManifest?
    private var sources: [String: PlaybackSource] = [:]
    private var sourceAccess: [String: OriginalFileAccess] = [:]
    private var artwork: PlaybackArtwork?
    private var cachedArtwork: (fingerprint: String, value: MPMediaItemArtwork)?
    private var items: [ObjectIdentifier: Int] = [:]
    private var segmentIndex = 0
    private var sessionId: String?
    private var revision = 0
    private var sequence = 0
    private var state = "empty"
    private var suppressionReason = "none"
    private var playIntent = false
    private var wasPlayingBeforeInterruption = false
    private var rate: Float = 1
    private var lastCommandId: String?
    private var error: JSObject?
    private var previewEnabled = false
    private var sleepTimer: Timer?
    private var sleepTimerPayload: JSObject?
    private var sleepDeadline: Date?
    private var sleepChapterEndMs: Int?
    private var periodicObserver: Any?
    private var lastDurableAt = Date.distantPast
    private var lastDurablePositionMs = 0
    private var lastObservedSegmentIndex = 0
    private var activeStartedAt: TimeInterval?
    private var activeDurationMs = 0

    var interfaceSoundsAreSuppressed: Bool {
        state == "playing" || state == "buffering"
    }
    private var retainedErrorPositionMs: Int?

    var absolutePositionMs: Int {
        if state == "error", let retainedErrorPositionMs { return retainedErrorPositionMs }
        if state == "ended" { return durationMs }
        guard let segment = currentSegment else { return 0 }
        // AVQueuePlayer briefly reports an indefinite time when it removes its last item.
        // Preserve the last checkpoint until the end notification confirms completion.
        let milliseconds = player.currentTime().seconds * 1_000
        guard milliseconds.isFinite else { return min(durationMs, max(segment.absoluteStartMs, lastDurablePositionMs)) }
        let position = Int(min(Double(segment.absoluteEndMs - segment.absoluteStartMs), max(0, milliseconds.rounded())))
        return min(durationMs, segment.absoluteStartMs + position)
    }

    var snapshot: JSObject {
        let segmentPosition = max(0, absolutePositionMs - (currentSegment?.absoluteStartMs ?? 0))
        let buffered = currentBufferedPositionMs
        return [
            "bridgeVersion": playbackBridgeVersion,
            "engineEpoch": engineEpoch,
            "queueId": manifest?.queueId ?? NSNull(),
            "playbackSessionId": sessionId ?? NSNull(),
            "revision": revision,
            "state": state,
            "suppressionReason": suppressionReason,
            "playIntent": playIntent,
            "segmentId": currentSegment?.id ?? NSNull(),
            "chapterId": currentChapter?.key ?? NSNull(),
            "absolutePositionMs": absolutePositionMs,
            "segmentPositionMs": segmentPosition,
            "durationMs": durationMs,
            "bufferedPositionMs": buffered,
            "activeDurationMs": currentActiveDurationMs,
            "rate": Double(rate),
            "sleepTimer": currentSleepTimerPayload ?? NSNull(),
            "route": routeSummary,
            "capabilities": capabilities,
            "lastCommandId": lastCommandId ?? NSNull(),
            "error": error ?? NSNull(),
            "observedAt": Self.timestamp(),
        ]
    }

    private var durationMs: Int { manifest?.segments.last?.absoluteEndMs ?? 0 }
    private var currentActiveDurationMs: Int {
        guard let activeStartedAt else { return activeDurationMs }
        return activeDurationMs + max(
            0,
            Int((ProcessInfo.processInfo.systemUptime - activeStartedAt) * 1_000)
        )
    }
    private var currentSegment: PlaybackManifest.Segment? { manifest?.segments[safe: segmentIndex] }
    private var currentChapter: PlaybackManifest.Chapter? {
        manifest?.chapters.first { absolutePositionMs >= $0.absoluteStartMs && absolutePositionMs < $0.absoluteEndMs }
    }

    private var currentBufferedPositionMs: Int {
        guard let range = player.currentItem?.loadedTimeRanges.last?.timeRangeValue else { return absolutePositionMs }
        let end = CMTimeGetSeconds(CMTimeRangeGetEnd(range))
        guard end.isFinite else { return absolutePositionMs }
        return min(durationMs, (currentSegment?.absoluteStartMs ?? 0) + Int((end * 1_000).rounded()))
    }

    private var routeSummary: JSObject {
        let output = AVAudioSession.sharedInstance().currentRoute.outputs.first
        let port = output?.portType
        let kind: String
        switch port {
        case .headphones, .headsetMic, .lineOut: kind = "wired"
        case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: kind = "bluetooth"
        case .airPlay: kind = "airplay"
        case .builtInReceiver, .builtInSpeaker: kind = "built-in"
        default: kind = "unknown"
        }
        return [
            "kind": kind,
            "name": output?.portName ?? "iPhone audio",
            "external": !["built-in", "unknown"].contains(kind),
        ]
    }

    private override init() {
        super.init()
        player.automaticallyWaitsToMinimizeStalling = true
        installObservers()
        restorePausedQueue()
    }

    deinit {
        if let periodicObserver { player.removeTimeObserver(periodicObserver) }
        NotificationCenter.default.removeObserver(self)
    }

    func applyCommand(
        id: String,
        expectedRevision: Int,
        operation: () throws -> Void
    ) throws -> JSObject {
        if journal.command(id: id) != nil {
            lastCommandId = id
            return snapshot
        }
        guard expectedRevision == revision else {
            throw PlaybackEngineError(code: "STALE_REVISION", message: "Playback changed before this command arrived.")
        }
        lastCommandId = id
        do {
            try operation()
        } catch let engineError as PlaybackEngineError {
            recordFailure(engineError)
            throw engineError
        }
        revision += 1
        let result = snapshot
        checkpoint(force: true)
        journal.recordCommand(id: id, snapshot: result)
        emitSnapshot(result)
        return result
    }

    func loadQueue(manifest object: JSObject, sources sourceObjects: [Any], artwork artworkObject: JSObject?) throws {
        let decodedManifest: PlaybackManifest = try decode(object)
        guard decodedManifest.schemaVersion == playbackBridgeVersion, !decodedManifest.segments.isEmpty else {
            throw PlaybackEngineError(code: "QUEUE_INVALID", message: "This audiobook queue version is unsupported.")
        }
        let decodedSources: [PlaybackSource] = try decode(sourceObjects)
        let byCapability = Dictionary(uniqueKeysWithValues: decodedSources.map { ($0.capability, $0) })
        let candidateAccess = try validateQueue(manifest: decodedManifest, sources: byCapability)
        let decodedArtwork: PlaybackArtwork? = try artworkObject.map { try decode($0) }
        for source in decodedSources {
            guard let url = URL(string: source.uri), let validURL = validateManagedURL(url) else { continue }
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: validURL.path
            )
        }
        if let decodedArtwork,
           let url = URL(string: decodedArtwork.uri),
           let validURL = validateManagedURL(url) {
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: validURL.path
            )
        }
        player.pause()
        manifest = decodedManifest
        player.removeAllItems()
        sourceAccess = candidateAccess
        sources = byCapability
        artwork = validatedArtwork(decodedArtwork)
        cachedArtwork = nil
        sessionId = "playback-session:ios:\(UUID().uuidString.lowercased())"
        rate = min(3, max(0.5, decodedManifest.rate))
        state = "loading"
        suppressionReason = "none"
        playIntent = false
        error = nil
        activeDurationMs = 0
        activeStartedAt = nil
        retainedErrorPositionMs = nil
        rebuildQueue(at: decodedManifest.initialAbsolutePositionMs, autoplay: false)
        state = "paused"
        updateNowPlaying()
    }

    func play(reason: String = "user-command") throws {
        if state == "ended" {
            try checkOriginalSources()
            rebuildQueue(at: 0, autoplay: false)
        }
        guard manifest != nil, player.currentItem != nil else {
            throw PlaybackEngineError(code: "QUEUE_INVALID", message: "Load an audiobook before playing.")
        }
        if playIntent && (state == "playing" || state == "buffering") { return }
        try checkOriginalSources()
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay, .allowBluetoothA2DP])
            try audio.setActive(true)
        } catch {
            throw PlaybackEngineError(code: "ENGINE_UNAVAILABLE", message: "The iOS audio session could not start.")
        }
        let wasPaused = state != "playing"
        playIntent = true
        suppressionReason = "none"
        self.error = nil
        player.playImmediately(atRate: rate)
        state = player.timeControlStatus == .waitingToPlayAtSpecifiedRate ? "buffering" : "playing"
        if state == "playing", activeStartedAt == nil {
            activeStartedAt = ProcessInfo.processInfo.systemUptime
        }
        if wasPaused { enqueue(kind: reason == "interruption-ended" ? "resume" : "play", reason: reason) }
        updateNowPlaying()
    }

    func pause(reason: String = "user-command", clearIntent: Bool = true) throws {
        if !playIntent && state == "paused" { return }
        let before = absolutePositionMs
        player.pause()
        closeActiveInterval()
        if clearIntent { playIntent = false }
        state = manifest == nil ? "empty" : "paused"
        if reason == "user-command" { suppressionReason = "none" }
        enqueue(kind: "pause", reason: reason, before: before, after: absolutePositionMs)
        updateNowPlaying()
    }

    func stop() throws {
        if state == "stopped" { return }
        try pause(reason: "stop", clearIntent: true)
        state = manifest == nil ? "empty" : "stopped"
        suppressionReason = "none"
        enqueue(kind: "stop", reason: "user-command")
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        updateNowPlaying()
    }

    func seek(to requestedMs: Int, reason: String) throws {
        guard manifest != nil else {
            throw PlaybackEngineError(code: "QUEUE_INVALID", message: "No audiobook queue is loaded.")
        }
        let before = absolutePositionMs
        let target = max(0, min(requestedMs, max(0, durationMs - 1)))
        if target == before { return }
        try checkOriginalSources()
        rebuildQueue(at: target, autoplay: playIntent)
        enqueue(kind: "seek", reason: reason, before: before, after: target)
        updateNowPlaying()
    }

    func moveChapter(forward: Bool) throws {
        guard let chapters = manifest?.chapters, !chapters.isEmpty else { return }
        let position = absolutePositionMs
        let target: Int?
        if forward {
            target = chapters.first { $0.absoluteStartMs > position + 500 }?.absoluteStartMs
        } else {
            target = chapters.last { $0.absoluteStartMs < position - 3_000 }?.absoluteStartMs ?? 0
        }
        if let target { try seek(to: target, reason: forward ? "next-chapter" : "previous-chapter") }
    }

    func setRate(_ requestedRate: Float) throws {
        guard requestedRate >= 0.5, requestedRate <= 3 else {
            throw PlaybackEngineError(code: "COMMAND_REJECTED", message: "The requested playback speed is unsupported.")
        }
        if abs(requestedRate - rate) < 0.001 { return }
        let position = absolutePositionMs
        rate = requestedRate
        if playIntent { player.rate = rate }
        enqueue(kind: "rate-change", reason: "user-command", before: position, after: position)
        updateNowPlaying()
    }

    func setSleepTimer(mode: String, durationMs: Int?) throws {
        cancelSleepTimer()
        let remaining: Int
        if mode == "chapter-end" {
            remaining = (currentChapter?.absoluteEndMs ?? self.durationMs) - absolutePositionMs
        } else {
            remaining = durationMs ?? 0
        }
        guard remaining > 0 else {
            throw PlaybackEngineError(code: "COMMAND_REJECTED", message: "The sleep timer duration is invalid.")
        }
        scheduleSleepTimer(mode: mode == "chapter-end" ? "chapter-end" : "duration", remainingMs: remaining)
    }

    private func scheduleSleepTimer(mode: String, remainingMs: Int) {
        sleepTimer?.invalidate()
        sleepTimer = nil
        if mode == "chapter-end" {
            sleepDeadline = nil
            sleepChapterEndMs = absolutePositionMs + remainingMs
            sleepTimerPayload = [
                "mode": mode,
                "remainingMs": remainingMs,
            ]
            return
        }
        sleepChapterEndMs = nil
        let deadline = Date().addingTimeInterval(Double(remainingMs) / 1_000)
        sleepDeadline = deadline
        sleepTimerPayload = [
            "mode": mode,
            "deadline": Self.timestamp(deadline),
            "remainingMs": remainingMs,
        ]
        sleepTimer = Timer.scheduledTimer(withTimeInterval: Double(remainingMs) / 1_000, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.expireSleepTimer() }
        }
    }

    func cancelSleepTimer() {
        sleepTimer?.invalidate()
        sleepTimer = nil
        sleepTimerPayload = nil
        sleepDeadline = nil
        sleepChapterEndMs = nil
    }

    func adoptPosition(_ positionMs: Int, provenance: String) throws {
        guard state != "playing", state != "buffering", !playIntent else {
            throw PlaybackEngineError(code: "COMMAND_REJECTED", message: "Pause playback before adopting another position.")
        }
        try seek(to: positionMs, reason: "adopt:\(provenance)")
    }

    func setSystemSurfacePreview(_ enabled: Bool) {
        if previewEnabled == enabled {
            updateNowPlaying()
            return
        }
        previewEnabled = enabled
        if !enabled { cachedArtwork = nil }
        revision += 1
        updateNowPlaying()
        checkpoint(force: true)
        emitSnapshot(snapshot)
    }

    private func rebuildQueue(at absoluteMs: Int, autoplay: Bool) {
        guard let manifest else { return }
        player.removeAllItems()
        items.removeAll()
        let targetIndex = manifest.segments.firstIndex {
            absoluteMs >= $0.absoluteStartMs && absoluteMs < $0.absoluteEndMs
        } ?? max(0, manifest.segments.count - 1)
        segmentIndex = targetIndex
        lastObservedSegmentIndex = targetIndex
        for index in targetIndex..<manifest.segments.count {
            let segment = manifest.segments[index]
            guard
                let access = sourceAccess[segment.playableCapability]
            else { continue }
            let validURL = access.url
            let item = AVPlayerItem(url: validURL)
            item.audioTimePitchAlgorithm = .timeDomain
            items[ObjectIdentifier(item)] = index
            player.insert(item, after: nil)
        }
        let segmentStart = manifest.segments[targetIndex].absoluteStartMs
        let localMs = max(0, absoluteMs - segmentStart)
        player.seek(to: CMTime(value: CMTimeValue(localMs), timescale: 1_000), toleranceBefore: .zero, toleranceAfter: .zero)
        if autoplay {
            player.playImmediately(atRate: rate)
            state = "playing"
            if activeStartedAt == nil { activeStartedAt = ProcessInfo.processInfo.systemUptime }
        } else {
            state = "paused"
        }
    }

    private func installObservers() {
        periodicObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 500, timescale: 1_000),
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.observePlayer() }
        }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(mediaServicesReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
        center.addObserver(self, selector: #selector(itemFailed(_:)), name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        installRemoteCommands()
    }

    private func installRemoteCommands() {
        let remote = MPRemoteCommandCenter.shared()
        remote.playCommand.addTarget { [weak self] _ in self?.systemCommand("remote-play") { try $0.play(reason: "remote-command") } ?? .commandFailed }
        remote.pauseCommand.addTarget { [weak self] _ in self?.systemCommand("remote-pause") { try $0.pause(reason: "remote-command") } ?? .commandFailed }
        remote.stopCommand.addTarget { [weak self] _ in self?.systemCommand("remote-stop") { try $0.stop() } ?? .commandFailed }
        remote.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.systemCommand("remote-toggle") {
                if $0.playIntent { try $0.pause(reason: "remote-command") } else { try $0.play(reason: "remote-command") }
            } ?? .commandFailed
        }
        remote.skipForwardCommand.preferredIntervals = [30]
        remote.skipForwardCommand.addTarget { [weak self] _ in self?.systemSeek(forward: true) ?? .commandFailed }
        remote.skipBackwardCommand.preferredIntervals = [15]
        remote.skipBackwardCommand.addTarget { [weak self] _ in self?.systemSeek(forward: false) ?? .commandFailed }
        remote.nextTrackCommand.addTarget { [weak self] _ in self?.systemCommand("remote-next-chapter") { try $0.moveChapter(forward: true) } ?? .commandFailed }
        remote.previousTrackCommand.addTarget { [weak self] _ in self?.systemCommand("remote-previous-chapter") { try $0.moveChapter(forward: false) } ?? .commandFailed }
        remote.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return self?.systemCommand("remote-seek") { try $0.seek(to: Int(event.positionTime * 1_000), reason: "remote-command") } ?? .commandFailed
        }
        remote.changePlaybackRateCommand.supportedPlaybackRates = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]
        remote.changePlaybackRateCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackRateCommandEvent else { return .commandFailed }
            return self?.systemCommand("remote-rate") { try $0.setRate(event.playbackRate) } ?? .commandFailed
        }
        updateRemoteCommandAvailability()
    }

    private func systemSeek(forward: Bool) -> MPRemoteCommandHandlerStatus {
        let offset = forward ? (manifest?.skipIntervals.forwardMs ?? 30_000) : -(manifest?.skipIntervals.backwardMs ?? 15_000)
        return systemCommand(forward ? "remote-skip-forward" : "remote-skip-back") {
            try $0.seek(to: $0.absolutePositionMs + offset, reason: "remote-command")
        }
    }

    private func systemCommand(
        _ prefix: String,
        operation: (WovenleafPlaybackEngine) throws -> Void
    ) -> MPRemoteCommandHandlerStatus {
        let beforeState = state
        let beforeIntent = playIntent
        let beforeSuppression = suppressionReason
        let beforePosition = absolutePositionMs
        let beforeRate = rate
        do {
            lastCommandId = "\(prefix):\(UUID().uuidString.lowercased())"
            try operation(self)
            let changed = state != beforeState
                || playIntent != beforeIntent
                || suppressionReason != beforeSuppression
                || abs(absolutePositionMs - beforePosition) > 100
                || abs(rate - beforeRate) > 0.001
            if !changed { return .success }
            revision += 1
            checkpoint(force: true)
            emitSnapshot(snapshot)
            return .success
        } catch {
            return .commandFailed
        }
    }

    private func observePlayer() {
        guard manifest != nil else { return }
        if let sleepDeadline, sleepDeadline <= Date() {
            expireSleepTimer()
            return
        }
        if let sleepChapterEndMs, absolutePositionMs >= sleepChapterEndMs {
            expireSleepTimer()
            return
        }
        if player.currentItem?.status == .failed {
            failPlayback(reason: "decoder-or-source-error")
            return
        }
        if let item = player.currentItem, let index = items[ObjectIdentifier(item)], index != segmentIndex {
            let before = absolutePositionMs
            segmentIndex = index
            if index != lastObservedSegmentIndex {
                lastObservedSegmentIndex = index
                enqueue(kind: "segment-transition", reason: "file-boundary", before: before, after: absolutePositionMs)
                checkpoint(force: true)
            }
        }
        if playIntent {
            if player.timeControlStatus == .waitingToPlayAtSpecifiedRate {
                closeActiveInterval()
                state = "buffering"
            } else if player.timeControlStatus == .playing {
                state = "playing"
                if activeStartedAt == nil { activeStartedAt = ProcessInfo.processInfo.systemUptime }
            }
        }
        revision += 1
        checkpoint(force: false)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    @objc private func interruption(_ notification: Notification) {
        guard
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        if type == .began {
            wasPlayingBeforeInterruption = playIntent && (state == "playing" || state == "buffering")
            let before = absolutePositionMs
            player.pause()
            closeActiveInterval()
            state = "paused"
            suppressionReason = "interruption"
            enqueue(kind: "interruption", reason: "began", before: before, after: absolutePositionMs)
            revision += 1
            checkpoint(force: true)
            updateNowPlaying()
            emitSnapshot(snapshot)
            return
        }
        let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
        if shouldResume && wasPlayingBeforeInterruption && playIntent {
            try? play(reason: "interruption-ended")
        } else if wasPlayingBeforeInterruption {
            playIntent = false
        }
        wasPlayingBeforeInterruption = false
        revision += 1
        checkpoint(force: true)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    @objc private func routeChanged(_ notification: Notification) {
        let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
        if reason == .oldDeviceUnavailable {
            let before = absolutePositionMs
            player.pause()
            closeActiveInterval()
            playIntent = false
            state = "paused"
            suppressionReason = "route-lost"
            enqueue(kind: "route-loss", reason: "output-removed", before: before, after: absolutePositionMs)
        }
        revision += 1
        checkpoint(force: true)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    @objc private func mediaServicesReset() {
        let position = absolutePositionMs
        player.pause()
        playIntent = false
        suppressionReason = "process-recreated"
        rebuildQueue(at: position, autoplay: false)
        enqueue(kind: "interruption", reason: "media-services-reset", before: position, after: position)
        revision += 1
        checkpoint(force: true)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    @objc private func didEnterBackground() {
        checkpoint(force: true)
    }

    @objc private func itemEnded(_ notification: Notification) {
        guard let item = notification.object as? AVPlayerItem, let index = items[ObjectIdentifier(item)], let manifest else { return }
        if index == manifest.segments.count - 1 {
            closeActiveInterval()
            playIntent = false
            state = "ended"
            enqueue(kind: "end", reason: "queue-ended", before: durationMs, after: durationMs)
            revision += 1
            checkpoint(force: true)
            updateNowPlaying()
            emitSnapshot(snapshot)
        }
    }

    @objc private func itemFailed(_ notification: Notification) {
        failPlayback(reason: "decoder-or-source-error")
    }

    private func failPlayback(reason: String) {
        guard state != "error" else { return }
        let before = absolutePositionMs
        player.pause()
        closeActiveInterval()
        playIntent = false
        state = "error"
        suppressionReason = "error"
        error = [
            "code": "playbackFailed",
            "message": "iOS playback could not continue this segment.",
            "recoverable": true,
            "capability": currentSegment?.playableCapability ?? NSNull(),
            "expectedFingerprint": currentSegment?.fingerprint ?? NSNull(),
        ]
        enqueue(kind: "failure", reason: reason, before: before, after: absolutePositionMs)
        revision += 1
        checkpoint(force: true)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    private func recordFailure(_ engineError: PlaybackEngineError) {
        let before = absolutePositionMs
        player.pause()
        closeActiveInterval()
        playIntent = false
        state = "error"
        suppressionReason = "error"
        let code: String
        switch engineError.code {
        case "ENGINE_UNAVAILABLE": code = "engineUnavailable"
        case "UNSUPPORTED_ASSET": code = "unsupportedAsset"
        case "CORRUPT_ASSET": code = "corruptAsset"
        case "RELINK_REQUIRED": code = "relinkRequired"
        case "AUTHENTICATION_REQUIRED": code = "authenticationRequired"
        case "QUEUE_INVALID": code = "queueInvalid"
        default: code = "commandRejected"
        }
        error = [
            "code": code,
            "message": engineError.message,
            "recoverable": ["engineUnavailable", "relinkRequired", "authenticationRequired", "commandRejected"].contains(code),
        ]
        enqueue(kind: "failure", reason: engineError.code.lowercased(), before: before, after: absolutePositionMs)
        revision += 1
        checkpoint(force: true)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    private func expireSleepTimer() {
        let before = absolutePositionMs
        player.pause()
        closeActiveInterval()
        playIntent = false
        state = "paused"
        suppressionReason = "sleep-timer"
        sleepTimer = nil
        sleepTimerPayload = nil
        sleepDeadline = nil
        sleepChapterEndMs = nil
        enqueue(kind: "sleep-expired", reason: "sleep-timer", before: before, after: absolutePositionMs)
        revision += 1
        checkpoint(force: true)
        updateNowPlaying()
        emitSnapshot(snapshot)
    }

    private func enqueue(kind: String, reason: String, before: Int? = nil, after: Int? = nil) {
        guard let manifest, let sessionId else { return }
        closeActiveInterval(commitOnly: true)
        sequence += 1
        let event: JSObject = [
            "bridgeVersion": playbackBridgeVersion,
            "id": "playback-event:ios:\(UUID().uuidString.lowercased())",
            "sequence": sequence,
            "engineEpoch": engineEpoch,
            "queueId": manifest.queueId,
            "playbackSessionId": sessionId,
            "revision": revision + 1,
            "kind": kind,
            "observedAt": Self.timestamp(),
            "activeDurationMs": activeDurationMs,
            "beforePositionMs": before ?? absolutePositionMs,
            "afterPositionMs": after ?? absolutePositionMs,
            "rate": Double(rate),
            "reason": reason,
            "confidence": 1.0,
            "segmentId": currentSegment?.id ?? NSNull(),
            "chapterId": currentChapter?.key ?? NSNull(),
            "error": error ?? NSNull(),
        ]
        journal.enqueue(event: event, terminal: ["stop", "end", "failure"].contains(kind))
        observer?.emitEventsAvailable(count: journal.eventCount)
    }

    private func closeActiveInterval(commitOnly: Bool = false) {
        if let activeStartedAt {
            activeDurationMs += max(
                0,
                Int((ProcessInfo.processInfo.systemUptime - activeStartedAt) * 1_000)
            )
            self.activeStartedAt = commitOnly && playIntent && state == "playing"
                ? ProcessInfo.processInfo.systemUptime
                : nil
        }
    }

    private func checkpoint(force: Bool) {
        guard let manifest else { return }
        let position = absolutePositionMs
        let wallElapsed = Date().timeIntervalSince(lastDurableAt) >= 10
        let mediaElapsed = abs(position - lastDurablePositionMs) >= 15_000
        guard force || wallElapsed || mediaElapsed else { return }
        closeActiveInterval(commitOnly: true)
        lastDurableAt = Date()
        lastDurablePositionMs = position
        let payload: JSObject = [
            "manifest": encodeObject(manifest),
            "sources": encodeObject(Array(sources.values)),
            "artwork": artwork.map { encodeObject($0) } ?? NSNull(),
            "snapshot": snapshot,
            "previewEnabled": previewEnabled,
            "sequence": sequence,
            "activeDurationMs": activeDurationMs,
        ]
        journal.saveState(payload)
    }

    private func restorePausedQueue() {
        guard
            let journalState = journal.state(),
            let manifestObject = journalState["manifest"] as? JSObject,
            let sourceObjects = journalState["sources"] as? [Any],
            let savedSnapshot = journalState["snapshot"] as? JSObject
        else { return }
        do {
            let restoredManifest: PlaybackManifest = try decode(manifestObject)
            let restoredSources: [PlaybackSource] = try decode(sourceObjects)
            let restoredArtwork: PlaybackArtwork? = (journalState["artwork"] as? JSObject).flatMap { try? decode($0) }
            let restoredByCapability = Dictionary(uniqueKeysWithValues: restoredSources.map { ($0.capability, $0) })
            manifest = restoredManifest
            sources = restoredByCapability
            artwork = validatedArtwork(restoredArtwork)
            cachedArtwork = nil
            retainedErrorPositionMs = savedSnapshot["absolutePositionMs"] as? Int ?? restoredManifest.initialAbsolutePositionMs
            sessionId = savedSnapshot["playbackSessionId"] as? String
            revision = (savedSnapshot["revision"] as? Int ?? 0) + 1
            sequence = journalState["sequence"] as? Int ?? 0
            activeDurationMs = journalState["activeDurationMs"] as? Int ?? 0
            rate = Float(savedSnapshot["rate"] as? Double ?? Double(restoredManifest.rate))
            previewEnabled = journalState["previewEnabled"] as? Bool ?? false
            sourceAccess = try validateQueue(manifest: restoredManifest, sources: restoredByCapability)
            suppressionReason = "process-recreated"
            playIntent = false
            state = "paused"
            rebuildQueue(at: savedSnapshot["absolutePositionMs"] as? Int ?? restoredManifest.initialAbsolutePositionMs, autoplay: false)
            retainedErrorPositionMs = nil
            updateNowPlaying()
        } catch {
            self.state = "error"
            suppressionReason = "error"
            self.error = [
                "code": "relinkRequired",
                "message": "A saved audiobook segment is missing or changed. Progress was preserved.",
                "recoverable": true,
            ]
        }
    }

    private func updateNowPlaying() {
        guard let manifest else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            updateRemoteCommandAvailability()
            return
        }
        let metadata = previewEnabled ? manifest.systemSurfaceMetadata.preview.title : manifest.systemSurfaceMetadata.private.title
        let contributor = previewEnabled
            ? manifest.systemSurfaceMetadata.preview.contributor
            : manifest.systemSurfaceMetadata.private.subtitle
        let chapterIndex = manifest.chapters.firstIndex { $0.key == currentChapter?.key }
        var nowPlaying: [String: Any] = [
            MPMediaItemPropertyTitle: metadata,
            MPMediaItemPropertyArtist: contributor,
            MPMediaItemPropertyAlbumTitle: previewEnabled ? (manifest.systemSurfaceMetadata.preview.series ?? "") : "",
            MPMediaItemPropertyComments: previewEnabled ? (currentChapter?.title ?? "") : "",
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(absolutePositionMs) / 1_000,
            MPMediaItemPropertyPlaybackDuration: Double(durationMs) / 1_000,
            MPNowPlayingInfoPropertyPlaybackRate: state == "playing" ? Double(rate) : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(rate),
            MPNowPlayingInfoPropertyExternalContentIdentifier: manifest.assetId,
        ]
        if previewEnabled, let chapterIndex {
            nowPlaying[MPNowPlayingInfoPropertyChapterNumber] = chapterIndex
            nowPlaying[MPNowPlayingInfoPropertyChapterCount] = manifest.chapters.count
            nowPlaying[MPMediaItemPropertyAlbumTrackNumber] = chapterIndex + 1
            nowPlaying[MPMediaItemPropertyAlbumTrackCount] = manifest.chapters.count
        }
        if let artwork = nowPlayingArtwork() {
            nowPlaying[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlaying
        updateRemoteCommandAvailability()
    }

    private func nowPlayingArtwork() -> MPMediaItemArtwork? {
        guard previewEnabled, let artwork else { return nil }
        if cachedArtwork?.fingerprint == artwork.fingerprint { return cachedArtwork?.value }
        guard
            let url = URL(string: artwork.uri),
            let validURL = validateManagedURL(url),
            let image = UIImage(contentsOfFile: validURL.path)
        else { return nil }
        let value = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        cachedArtwork = (artwork.fingerprint, value)
        return value
    }

    private func updateRemoteCommandAvailability() {
        let remote = MPRemoteCommandCenter.shared()
        let hasQueue = manifest != nil && player.currentItem != nil
        remote.playCommand.isEnabled = hasQueue && !playIntent
        remote.pauseCommand.isEnabled = hasQueue && playIntent
        remote.stopCommand.isEnabled = hasQueue && state != "stopped" && state != "empty"
        remote.togglePlayPauseCommand.isEnabled = hasQueue
        remote.skipForwardCommand.isEnabled = hasQueue
        remote.skipBackwardCommand.isEnabled = hasQueue
        remote.changePlaybackPositionCommand.isEnabled = hasQueue
        remote.changePlaybackRateCommand.isEnabled = hasQueue
        remote.nextTrackCommand.isEnabled = hasQueue && (manifest?.chapters.contains {
            $0.absoluteStartMs > absolutePositionMs + 500
        } ?? false)
        remote.previousTrackCommand.isEnabled = hasQueue && absolutePositionMs > 0
        remote.skipForwardCommand.preferredIntervals = [
            NSNumber(value: Double(manifest?.skipIntervals.forwardMs ?? 30_000) / 1_000)
        ]
        remote.skipBackwardCommand.preferredIntervals = [
            NSNumber(value: Double(manifest?.skipIntervals.backwardMs ?? 15_000) / 1_000)
        ]
    }

    private var currentSleepTimerPayload: JSObject? {
        guard var payload = sleepTimerPayload else { return nil }
        if let sleepChapterEndMs {
            payload["remainingMs"] = max(0, sleepChapterEndMs - absolutePositionMs)
        } else if let sleepDeadline {
            payload["remainingMs"] = max(0, Int((sleepDeadline.timeIntervalSinceNow * 1_000).rounded()))
        }
        return payload
    }

    private func emitSnapshot(_ value: JSObject) {
        observer?.emitSnapshot(value)
    }

    private func validateManagedURL(_ url: URL) -> URL? {
        guard url.isFileURL else { return nil }
        let candidate = url.standardizedFileURL.resolvingSymlinksInPath()
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
        let root = library.appendingPathComponent("NoCloud", isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
        return candidate.path.hasPrefix(root.path + "/") ? candidate : nil
    }

    private func validatedArtwork(_ candidate: PlaybackArtwork?) -> PlaybackArtwork? {
        guard
            let candidate,
            ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].contains(candidate.mediaType),
            let url = URL(string: candidate.uri),
            let validURL = validateManagedURL(url),
            FileManager.default.isReadableFile(atPath: validURL.path),
            let size = (try? FileManager.default.attributesOfItem(atPath: validURL.path)[.size] as? NSNumber)?.intValue,
            size == candidate.byteSize,
            (try? sha256(validURL)) == candidate.fingerprint
        else { return nil }
        return candidate
    }

    private func validateQueue(
        manifest: PlaybackManifest,
        sources: [String: PlaybackSource]
    ) throws -> [String: OriginalFileAccess] {
        var acquired: [String: OriginalFileAccess] = [:]
        for segment in manifest.segments {
            guard let source = sources[segment.playableCapability],
                  source.fingerprint == segment.fingerprint, source.mediaType == segment.mediaType else {
                throw PlaybackEngineError(code: "RELINK_REQUIRED", message: "An audiobook file is unavailable. Choose it again; your progress is safe.")
            }
            do {
                let access = try WovenleafFileReferences.acquire(source.uri)
                let size = try access.coordinated { try $0.resourceValues(forKeys: [.fileSizeKey]).fileSize }
                guard size == source.byteSize, try access.fingerprint() == source.fingerprint else {
                    throw WovenleafFileReferences.unavailable("FILE_CHANGED")
                }
                acquired[segment.playableCapability] = access
            } catch {
                throw PlaybackEngineError(code: "RELINK_REQUIRED", message: "An audiobook file is missing, changed, or no longer accessible. Choose it again; your progress is safe.")
            }
        }
        return acquired
    }

    private func checkOriginalSources() throws {
        do { for access in sourceAccess.values { try access.check() } }
        catch { throw PlaybackEngineError(code: "RELINK_REQUIRED", message: "An audiobook file is no longer available. Choose it again; your progress is safe.") }
    }

    private func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func decode<Value: Decodable>(_ object: Any) throws -> Value {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder().decode(Value.self, from: data)
    }

    private func encodeObject<Value: Encodable>(_ value: Value) -> any JSValue {
        guard
            let data = try? JSONEncoder().encode(value),
            let object = try? JSONSerialization.jsonObject(with: data) as? any JSValue
        else { return NSNull() }
        return object
    }

    private static func timestamp(_ date: Date = Date()) -> String {
        ISO8601DateFormatter.playback.string(from: date)
    }
}

private final class PlaybackJournal {
    private let lock = NSLock()
    private var database: OpaquePointer?

    var eventCount: Int {
        lock.withLock {
            queryInt("SELECT COUNT(*) FROM playback_events")
        }
    }

    init() {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Playback", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableRoot = root
        try? mutableRoot.setResourceValues(values)
        let url = root.appendingPathComponent("journal-v1.sqlite")
        sqlite3_open_v2(url.path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
        execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
        execute("""
        CREATE TABLE IF NOT EXISTS playback_state(key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS playback_events(
          id TEXT PRIMARY KEY NOT NULL,
          sequence INTEGER NOT NULL,
          terminal INTEGER NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS playback_events_sequence ON playback_events(sequence, id);
        CREATE TABLE IF NOT EXISTS playback_commands(
          id TEXT PRIMARY KEY NOT NULL,
          snapshot TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        """)
    }

    deinit { sqlite3_close(database) }

    func saveState(_ payload: JSObject) {
        guard let json = jsonString(payload) else { return }
        lock.withLock {
            execute("BEGIN IMMEDIATE")
            statement("INSERT OR REPLACE INTO playback_state(key, payload) VALUES ('active', ?)", values: [json])
            execute("COMMIT")
        }
    }

    func state() -> JSObject? {
        lock.withLock {
            guard let json = queryText("SELECT payload FROM playback_state WHERE key = 'active'") else { return nil }
            return jsonObject(json)
        }
    }

    func enqueue(event: JSObject, terminal: Bool) {
        guard
            let id = event["id"] as? String,
            let sequence = event["sequence"] as? Int,
            let json = jsonString(event)
        else { return }
        lock.withLock {
            execute("BEGIN IMMEDIATE")
            statement(
                "INSERT OR IGNORE INTO playback_events(id, sequence, terminal, payload) VALUES (?, ?, ?, ?)",
                values: [id, sequence, terminal ? 1 : 0, json]
            )
            statement("""
            DELETE FROM playback_events
            WHERE terminal = 0 AND id IN (
              SELECT id FROM playback_events WHERE terminal = 0 ORDER BY sequence DESC, id DESC LIMIT -1 OFFSET 1024
            )
            """)
            execute("COMMIT")
        }
    }

    func events() -> [JSObject] {
        lock.withLock {
            queryTexts("SELECT payload FROM playback_events ORDER BY sequence, id").compactMap(jsonObject)
        }
    }

    func acknowledge(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        lock.withLock {
            execute("BEGIN IMMEDIATE")
            for id in ids { statement("DELETE FROM playback_events WHERE id = ?", values: [id]) }
            execute("COMMIT")
        }
    }

    func recordCommand(id: String, snapshot: JSObject) {
        guard let json = jsonString(snapshot) else { return }
        lock.withLock {
            statement(
                "INSERT OR REPLACE INTO playback_commands(id, snapshot, applied_at) VALUES (?, ?, ?)",
                values: [id, json, ISO8601DateFormatter.playback.string(from: Date())]
            )
            statement("""
            DELETE FROM playback_commands WHERE id IN (
              SELECT id FROM playback_commands ORDER BY applied_at DESC, id DESC LIMIT -1 OFFSET 256
            )
            """)
        }
    }

    func command(id: String) -> JSObject? {
        lock.withLock {
            guard let json = queryText("SELECT snapshot FROM playback_commands WHERE id = ?", values: [id]) else { return nil }
            return jsonObject(json)
        }
    }

    private func execute(_ sql: String) {
        sqlite3_exec(database, sql, nil, nil, nil)
    }

    private func statement(_ sql: String, values: [Any] = []) {
        var handle: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &handle, nil) == SQLITE_OK, let handle else { return }
        defer { sqlite3_finalize(handle) }
        for (index, value) in values.enumerated() {
            let position = Int32(index + 1)
            switch value {
            case let string as String: sqlite3_bind_text(handle, position, string, -1, sqliteTransient)
            case let integer as Int: sqlite3_bind_int64(handle, position, sqlite3_int64(integer))
            default: sqlite3_bind_null(handle, position)
            }
        }
        sqlite3_step(handle)
    }

    private func queryText(_ sql: String, values: [Any] = []) -> String? {
        queryTexts(sql, values: values).first
    }

    private func queryTexts(_ sql: String, values: [Any] = []) -> [String] {
        var handle: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &handle, nil) == SQLITE_OK, let handle else { return [] }
        defer { sqlite3_finalize(handle) }
        for (index, value) in values.enumerated() {
            if let string = value as? String { sqlite3_bind_text(handle, Int32(index + 1), string, -1, sqliteTransient) }
        }
        var rows: [String] = []
        while sqlite3_step(handle) == SQLITE_ROW {
            if let text = sqlite3_column_text(handle, 0) { rows.append(String(cString: text)) }
        }
        return rows
    }

    private func queryInt(_ sql: String) -> Int {
        var handle: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &handle, nil) == SQLITE_OK, let handle else { return 0 }
        defer { sqlite3_finalize(handle) }
        return sqlite3_step(handle) == SQLITE_ROW ? Int(sqlite3_column_int64(handle, 0)) : 0
    }

    private func jsonString(_ object: Any) -> String? {
        guard
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            let string = String(data: data, encoding: .utf8)
        else { return nil }
        return string
    }

    private func jsonObject(_ string: String) -> JSObject? {
        guard
            let data = string.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? JSObject
        else { return nil }
        return object
    }
}

private extension NSLock {
    func withLock<Value>(_ operation: () -> Value) -> Value {
        lock()
        defer { unlock() }
        return operation()
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? { indices.contains(index) ? self[index] : nil }
}

private extension ISO8601DateFormatter {
    static let playback: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
