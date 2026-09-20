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
