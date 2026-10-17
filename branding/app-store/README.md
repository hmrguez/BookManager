# App Store preparation assets

## Native App Store screenshots

Captured on 3 October 2026 from the unmodified native app, built with stable
Xcode 27.0 (27A266a), using dedicated iOS/iPadOS 26.5 simulators:

- `screenshots/iphone-6.9/`: iPhone 17 Pro Max, 1320 × 2868 pixels.
- `screenshots/ipad-13/`: iPad Pro 13-inch (M5), 2064 × 2752 pixels.

Each set contains three portrait captures. iPhone shows the library, EPUB reader,
and reading appearance controls. iPad shows the fuller library, two-page EPUB
reader, and Reading/Finished/Did Not Finish shelves. The iPad demo has 25 books:
6 To Be Read, 5 Up Next, 5 Reading, 7 Finished, and 2 Did Not Finish. Moby-Dick and
Les Misérables are the two fictional DNF entries; all progress and ratings are
demo data, not statements about a real reader.

The five baseline entries reuse the four books/covers in
`../marketing/demo-library.csv` and an original Wovenleaf EPUB fixture, *A Quiet
Reading Room*. The extra 20 iPad books and their Open Library cover-source URLs
are recorded in `screenshots/ipad-demo-books.json`. Book cover artwork remains
attributable to its respective rights holders. These demo libraries and imported
reading content are not bundled into the release app.

Screenshots were saved directly with `simctl io screenshot`, without compositing,
resizing, or editing pixels. Both resolution sets were accepted by App Store
Connect's English (U.S.) media manager. The 6.9-inch iPhone set is automatically
used for the 6.5-inch display slot, and the 13-inch iPad set for other iPad sizes.

The retired Unlimited purchase preview was removed on 17 October 2026.
