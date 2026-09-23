import Foundation
let snapshot: [String: Any] = ["kind": "wovenleaf-libby", "version": 1, "id": UUID().uuidString,
 "capturedAt": ISO8601DateFormatter().string(from: Date()),
 "observations": [["titleId": "123", "format": "ebook", "title": "A test book", "author": "A. Reader", "percent": 0]]]
let data = try LibbyInbox.validate(snapshot)
precondition(!data.isEmpty)
var extra = snapshot; extra["token"] = "rejected"
precondition((try? LibbyInbox.validate(extra)) == nil)
var badNumber = snapshot; badNumber["observations"] = [["titleId": "123", "format": "ebook", "title": "A test book", "author": "A. Reader", "percent": true]]
precondition((try? LibbyInbox.validate(badNumber)) == nil)
var duplicate = snapshot; duplicate["observations"] = [snapshot["observations"] as! [[String: Any]]][0] + [snapshot["observations"] as! [[String: Any]]][0]
precondition((try? LibbyInbox.validate(duplicate)) == nil)
print("PASS: native boundary accepts a zero-percent capture and rejects credentials, booleans and duplicate titles.")
var covered = snapshot
var observation = (snapshot["observations"] as! [[String: Any]])[0]
observation["coverUrl"] = "https://img1.od-cdn.com/ImageType-400/1234-1/{ABC-123}IMG400.JPG"
covered["observations"] = [observation]
precondition((try? LibbyInbox.validate(covered)) != nil)
for url in ["https://evil.example/cover.jpg", "http://img1.od-cdn.com/ImageType-400/a.jpg", "https://img1.od-cdn.com/ImageType-400/a.jpg?token=secret", "https://img1.od-cdn.com@evil.example/ImageType-400/a.jpg"] {
    observation["coverUrl"] = url; covered["observations"] = [observation]
    precondition((try? LibbyInbox.validate(covered)) == nil)
}
print("PASS: native boundary accepts public cover URLs and rejects arbitrary hosts, credentials, queries and insecure URLs.")

var empty = snapshot; empty["observations"] = [[String: Any]]()
precondition((try? LibbyInbox.validate(empty)) == nil)
empty["emptyShelf"] = true
precondition((try? LibbyInbox.validate(empty)) != nil)
empty["emptyShelf"] = 1
precondition((try? LibbyInbox.validate(empty)) == nil)
var ambiguous = snapshot; ambiguous["emptyShelf"] = true
precondition((try? LibbyInbox.validate(ambiguous)) == nil)
print("PASS: only an explicitly empty shelf is accepted; numeric flags and mixed loan/empty states are rejected.")
