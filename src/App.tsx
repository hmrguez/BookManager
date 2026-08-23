import { useState, type CSSProperties } from 'react'
import './App.css'

const shelves = ['All books', 'Reading', 'Finished'] as const
type Shelf = (typeof shelves)[number]

const books = [
  { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', status: 'Reading', progress: 68, tone: 'ember', mark: 'LH' },
  { title: 'A Gentleman in Moscow', author: 'Amor Towles', status: 'Reading', progress: 34, tone: 'ink', mark: 'GM' },
  { title: 'The Overstory', author: 'Richard Powers', status: 'Finished', progress: 100, tone: 'moss', mark: 'OS' },
] as const

function App() {
  const [activeShelf, setActiveShelf] = useState<Shelf>('All books')
  const [progress, setProgress] = useState(68)

  const visibleBooks = books.filter(
    (book) => activeShelf === 'All books' || book.status === activeShelf,
  )

  const advanceReading = () => {
    setProgress((current) => (current >= 100 ? 12 : Math.min(current + 8, 100)))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="BookManager home">
          <span className="wordmark-dot" aria-hidden="true" />
          BookManager
        </a>
        <button className="avatar" type="button" aria-label="Open profile">HM</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Your private reading room</p>
          <h1>Keep the books<br />that keep you.</h1>
          <p className="intro">
            A calm place for every story you are reading, remembering, or saving for later.
          </p>
        </div>

        <article className="current-read">
          <div className="mini-cover" aria-hidden="true">
            <span>URSULA K.<br />LE GUIN</span>
            <strong>THE LEFT<br />HAND OF<br />DARKNESS</strong>
          </div>
          <div className="current-details">
            <span className="status-label">Currently reading</span>
            <h2>The Left Hand of Darkness</h2>
            <p>Ursula K. Le Guin</p>
            <button className="progress-control" type="button" onClick={advanceReading}>
              <span className="progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
              <span>{progress}%</span>
              <span className="progress-action">+8</span>
            </button>
          </div>
        </article>
      </section>

      <section className="library" aria-labelledby="library-heading">
        <div className="library-heading">
          <div>
            <p className="eyebrow">The collection</p>
            <h2 id="library-heading">My library</h2>
          </div>
          <button className="add-button" type="button" aria-label="Add a book"><span aria-hidden="true">+</span> Add a title</button>
        </div>

        <nav className="shelf-tabs" aria-label="Filter library">
          {shelves.map((shelf) => (
            <button className={activeShelf === shelf ? 'active' : ''} key={shelf} type="button" onClick={() => setActiveShelf(shelf)}>
              {shelf}
            </button>
          ))}
        </nav>

        <div className="book-grid">
          {visibleBooks.map((book, index) => (
            <article className="book-card" key={book.title} style={{ '--delay': `${index * 90}ms` } as CSSProperties}>
              <div className={`book-cover ${book.tone}`}><span>{book.mark}</span></div>
              <div className="book-meta">
                <span className="book-status">{book.status}</span>
                <h3>{book.title}</h3>
                <p>{book.author}</p>
                <div className="book-progress" aria-label={`${book.progress}% complete`}><span style={{ width: `${book.progress}%` }} /></div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
