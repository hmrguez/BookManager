import {
  catalogSchema,
  metadataCandidateValueSchema,
  metadataOverrideIdSchema,
  resolveMetadataField,
  sourceClaimIdSchema,
  sourceRecordIdSchema,
  userMetadataOverrideValueSchema,
  workIdSchema,
  editionIdSchema,
  assetIdSchema,
  identifierIdSchema,
  ownershipIdSchema,
  accessGrantIdSchema,
  loanIdSchema,
  personIdSchema,
  contributorIdSchema,
  workPartIdSchema,
  progressSnapshotIdSchema,
  type JsonValue,
  type MetadataField,
  type MetadataTarget,
} from '../../src/domain/catalog'

const recordedAt = '2026-08-25T10:00:00.000Z'

export const fixtureIds = {
  works: {
    leftHand: workIdSchema.parse('work:left-hand-of-darkness'),
    masterAndMargarita: workIdSchema.parse('work:master-and-margarita'),
    anthology: workIdSchema.parse('work:exhalation-anthology'),
    anthologyStoryOne: workIdSchema.parse('work:merchant-and-alchemists-gate'),
    anthologyStoryTwo: workIdSchema.parse('work:exhalation-story'),
    missingIsbn: workIdSchema.parse('work:house-on-mango-street'),
    libby: workIdSchema.parse('work:cloud-cuckoo-land'),
    corrected: workIdSchema.parse('work:piranesi'),
  },
  editions: {
    leftHandEbook: editionIdSchema.parse('edition:left-hand-ebook'),
    leftHandAudio: editionIdSchema.parse('edition:left-hand-audio'),
    translated: editionIdSchema.parse('edition:master-and-margarita-english-ebook'),
    anthology: editionIdSchema.parse('edition:exhalation-hardcover'),
    missingIsbn: editionIdSchema.parse('edition:house-on-mango-street-print'),
    libby: editionIdSchema.parse('edition:cloud-cuckoo-land-libby-audio'),
    corrected: editionIdSchema.parse('edition:piranesi-ebook'),
  },
  assets: {
    leftHandEpub: assetIdSchema.parse('asset:left-hand-epub'),
    leftHandEbookCover: assetIdSchema.parse('asset:left-hand-ebook-cover'),
    leftHandM4b: assetIdSchema.parse('asset:left-hand-m4b'),
    leftHandAudioCover: assetIdSchema.parse('asset:left-hand-audio-cover'),
    translatedEpub: assetIdSchema.parse('asset:master-and-margarita-epub'),
    libbyStream: assetIdSchema.parse('asset:cloud-cuckoo-land-libby-stream'),
  },
  sources: {
    google: sourceRecordIdSchema.parse('source-record:google:left-hand'),
    openLibrary: sourceRecordIdSchema.parse('source-record:open-library:left-hand'),
    libby: sourceRecordIdSchema.parse('source-record:libby:cloud-cuckoo-land'),
    incorrectMetadata: sourceRecordIdSchema.parse('source-record:google:piranesi'),
  },
  claims: {
    incorrectTitle: sourceClaimIdSchema.parse('source-claim:google:piranesi:title'),
  },
  people: {
    leGuin: personIdSchema.parse('person:ursula-k-le-guin'),
    narrator: personIdSchema.parse('person:george-guidall'),
    bulgakov: personIdSchema.parse('person:mikhail-bulgakov'),
    translator: personIdSchema.parse('person:richard-pevear'),
    tedChiang: personIdSchema.parse('person:ted-chiang'),
  },
} as const

const correctedTitleTarget = { type: 'work', id: fixtureIds.works.corrected } as const

const incorrectTitleCandidate = metadataCandidateValueSchema.parse({
  kind: 'source',
  target: correctedTitleTarget,
  field: 'work.title',
  value: 'Piranezi',
  sourceRecordId: fixtureIds.sources.incorrectMetadata,
  claimId: fixtureIds.claims.incorrectTitle,
  observedAt: '2026-08-20T09:00:00.000Z',
  confidence: 0.74,
})

export const correctedTitleOverride = userMetadataOverrideValueSchema.parse({
  id: metadataOverrideIdSchema.parse('metadata-override:piranesi:title'),
  target: correctedTitleTarget,
  field: 'work.title',
  value: 'Piranesi',
  correctedAt: '2026-08-21T12:00:00.000Z',
  note: 'Corrected the provider typo.',
})

function localField<T extends JsonValue>(
  target: MetadataTarget,
  field: MetadataField,
  value: T,
) {
  return resolveMetadataField(
    metadataCandidateValueSchema.parse({
      kind: 'local',
      target,
      field,
      value,
      recordedAt,
      method: 'manual-entry',
    }),
  )
}

function workRef(id: (typeof fixtureIds.works)[keyof typeof fixtureIds.works]) {
  return { type: 'work', id } as const
}

function editionRef(id: (typeof fixtureIds.editions)[keyof typeof fixtureIds.editions]) {
  return { type: 'edition', id } as const
}

function personRef(id: (typeof fixtureIds.people)[keyof typeof fixtureIds.people]) {
  return { type: 'person', id } as const
}

export const representativeCatalog = catalogSchema.parse({
  works: [
    {
      id: fixtureIds.works.leftHand,
      kind: 'single',
      title: localField(workRef(fixtureIds.works.leftHand), 'work.title', 'The Left Hand of Darkness'),
      originalLanguage: localField(
        workRef(fixtureIds.works.leftHand),
        'work.originalLanguage',
        'en',
      ),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.masterAndMargarita,
      kind: 'single',
      title: localField(
        workRef(fixtureIds.works.masterAndMargarita),
        'work.title',
        'Мастер и Маргарита',
      ),
      originalLanguage: localField(
        workRef(fixtureIds.works.masterAndMargarita),
        'work.originalLanguage',
        'ru',
      ),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.anthology,
      kind: 'anthology',
      title: localField(workRef(fixtureIds.works.anthology), 'work.title', 'Exhalation'),
      originalLanguage: localField(
        workRef(fixtureIds.works.anthology),
        'work.originalLanguage',
        'en',
      ),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.anthologyStoryOne,
      kind: 'single',
      title: localField(
        workRef(fixtureIds.works.anthologyStoryOne),
        'work.title',
        "The Merchant and the Alchemist's Gate",
      ),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.anthologyStoryTwo,
      kind: 'single',
      title: localField(workRef(fixtureIds.works.anthologyStoryTwo), 'work.title', 'Exhalation'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.missingIsbn,
      kind: 'single',
      title: localField(
        workRef(fixtureIds.works.missingIsbn),
        'work.title',
        'The House on Mango Street',
      ),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.libby,
      kind: 'single',
      title: localField(workRef(fixtureIds.works.libby), 'work.title', 'Cloud Cuckoo Land'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.works.corrected,
      kind: 'single',
      title: resolveMetadataField(incorrectTitleCandidate, correctedTitleOverride),
      createdAt: recordedAt,
      updatedAt: correctedTitleOverride.correctedAt,
    },
  ],
  editions: [
    {
      id: fixtureIds.editions.leftHandEbook,
      workId: fixtureIds.works.leftHand,
      medium: 'ebook',
      title: localField(
        editionRef(fixtureIds.editions.leftHandEbook),
        'edition.title',
        'The Left Hand of Darkness',
      ),
      language: localField(editionRef(fixtureIds.editions.leftHandEbook), 'edition.language', 'en'),
      pageCount: localField(editionRef(fixtureIds.editions.leftHandEbook), 'edition.pageCount', 304),
      coverAssetId: fixtureIds.assets.leftHandEbookCover,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.editions.leftHandAudio,
      workId: fixtureIds.works.leftHand,
      medium: 'audiobook',
      title: localField(
        editionRef(fixtureIds.editions.leftHandAudio),
        'edition.title',
        'The Left Hand of Darkness',
      ),
      language: localField(editionRef(fixtureIds.editions.leftHandAudio), 'edition.language', 'en'),
      durationMs: localField(
        editionRef(fixtureIds.editions.leftHandAudio),
        'edition.durationMs',
        35_820_000,
      ),
      coverAssetId: fixtureIds.assets.leftHandAudioCover,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.editions.translated,
      workId: fixtureIds.works.masterAndMargarita,
      medium: 'ebook',
      title: localField(
        editionRef(fixtureIds.editions.translated),
        'edition.title',
        'The Master and Margarita',
      ),
      language: localField(editionRef(fixtureIds.editions.translated), 'edition.language', 'en'),
      pageCount: localField(editionRef(fixtureIds.editions.translated), 'edition.pageCount', 448),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.editions.anthology,
      workId: fixtureIds.works.anthology,
      medium: 'print',
      binding: 'hardcover',
      title: localField(editionRef(fixtureIds.editions.anthology), 'edition.title', 'Exhalation'),
      language: localField(editionRef(fixtureIds.editions.anthology), 'edition.language', 'en'),
      pageCount: localField(editionRef(fixtureIds.editions.anthology), 'edition.pageCount', 368),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.editions.missingIsbn,
      workId: fixtureIds.works.missingIsbn,
      medium: 'print',
      binding: 'paperback',
      title: localField(
        editionRef(fixtureIds.editions.missingIsbn),
        'edition.title',
        'The House on Mango Street',
      ),
      language: localField(editionRef(fixtureIds.editions.missingIsbn), 'edition.language', 'en'),
      pageCount: localField(editionRef(fixtureIds.editions.missingIsbn), 'edition.pageCount', 110),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.editions.libby,
      workId: fixtureIds.works.libby,
      medium: 'audiobook',
      title: localField(
        editionRef(fixtureIds.editions.libby),
        'edition.title',
        'Cloud Cuckoo Land',
      ),
      language: localField(editionRef(fixtureIds.editions.libby), 'edition.language', 'en'),
      durationMs: localField(
        editionRef(fixtureIds.editions.libby),
        'edition.durationMs',
        52_440_000,
      ),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.editions.corrected,
      workId: fixtureIds.works.corrected,
      medium: 'ebook',
      title: localField(editionRef(fixtureIds.editions.corrected), 'edition.title', 'Piranesi'),
      language: localField(editionRef(fixtureIds.editions.corrected), 'edition.language', 'en'),
      pageCount: localField(editionRef(fixtureIds.editions.corrected), 'edition.pageCount', 272),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
  ],
  assets: [
    {
      id: fixtureIds.assets.leftHandEpub,
      editionId: fixtureIds.editions.leftHandEbook,
      role: 'content',
      format: 'epub',
      mediaType: 'application/epub+zip',
      location: {
        kind: 'managed-file',
        relativePath: 'books/left-hand.epub',
        sha256: 'a'.repeat(64),
        byteSize: 1_200_000,
      },
      createdAt: recordedAt,
    },
    {
      id: fixtureIds.assets.leftHandEbookCover,
      editionId: fixtureIds.editions.leftHandEbook,
      role: 'cover',
      format: 'image',
      mediaType: 'image/jpeg',
      location: {
        kind: 'remote',
        uri: 'https://books.google.example/left-hand/ebook-cover.jpg',
        sourceRecordId: fixtureIds.sources.google,
      },
      createdAt: recordedAt,
    },
    {
      id: fixtureIds.assets.leftHandM4b,
      editionId: fixtureIds.editions.leftHandAudio,
      role: 'content',
      format: 'm4b',
      mediaType: 'audio/mp4',
      location: {
        kind: 'linked-file',
        bookmarkId: 'bookmark:left-hand-audio',
        fingerprint: 'sha256:left-hand-audio',
        lastKnownName: 'The Left Hand of Darkness.m4b',
      },
      createdAt: recordedAt,
    },
    {
      id: fixtureIds.assets.leftHandAudioCover,
      editionId: fixtureIds.editions.leftHandAudio,
      role: 'cover',
      format: 'image',
      mediaType: 'image/jpeg',
      location: {
        kind: 'missing',
        fingerprint: 'sha256:left-hand-audio-cover',
        lastKnownName: 'cover.jpg',
      },
      createdAt: recordedAt,
    },
    {
      id: fixtureIds.assets.translatedEpub,
      editionId: fixtureIds.editions.translated,
      role: 'content',
      format: 'epub',
      mediaType: 'application/epub+zip',
      location: {
        kind: 'managed-file',
        relativePath: 'books/master-and-margarita-en.epub',
        sha256: 'b'.repeat(64),
        byteSize: 1_450_000,
      },
      createdAt: recordedAt,
    },
    {
      id: fixtureIds.assets.libbyStream,
      editionId: fixtureIds.editions.libby,
      role: 'content',
      format: 'mp3',
      mediaType: 'audio/mpeg',
      location: {
        kind: 'remote',
        uri: 'https://listen.libby.example/loan/cloud-cuckoo-land',
        sourceRecordId: fixtureIds.sources.libby,
        expiresAt: '2026-09-01T10:00:00.000Z',
      },
      createdAt: recordedAt,
    },
  ],
  identifiers: [
    {
      id: identifierIdSchema.parse('identifier:left-hand:isbn13'),
      owner: editionRef(fixtureIds.editions.leftHandEbook),
      scheme: 'isbn-13',
      value: '978-0-441-47812-5',
      normalizedValue: '9780441478125',
      sourceRecordIds: [fixtureIds.sources.google, fixtureIds.sources.openLibrary],
      createdAt: recordedAt,
    },
    {
      id: identifierIdSchema.parse('identifier:master-and-margarita:isbn13'),
      owner: editionRef(fixtureIds.editions.translated),
      scheme: 'isbn-13',
      value: '978-0-14-310827-6',
      normalizedValue: '9780143108276',
      sourceRecordIds: [],
      createdAt: recordedAt,
    },
  ],
  sourceRecords: [
    {
      id: fixtureIds.sources.google,
      source: { kind: 'metadata-provider', name: 'Google Books' },
      externalKey: 'google-volume-left-hand',
      observedAt: '2026-08-24T10:00:00.000Z',
      importedAt: recordedAt,
      claims: [],
      observedIdentifiers: [
        {
          target: editionRef(fixtureIds.editions.leftHandEbook),
          scheme: 'isbn-13',
          value: '978-0-441-47812-5',
          normalizedValue: '9780441478125',
          confidence: 0.99,
        },
      ],
      rawPayload: { volumeId: 'google-volume-left-hand' },
    },
    {
      id: fixtureIds.sources.openLibrary,
      source: { kind: 'metadata-provider', name: 'Open Library' },
      externalKey: 'OL7533849M',
      observedAt: '2026-08-24T11:00:00.000Z',
      importedAt: recordedAt,
      claims: [],
      observedIdentifiers: [
        {
          target: editionRef(fixtureIds.editions.leftHandEbook),
          scheme: 'isbn-13',
          value: '9780441478125',
          normalizedValue: '9780441478125',
          confidence: 0.97,
        },
      ],
      rawPayload: { key: '/books/OL7533849M' },
    },
    {
      id: fixtureIds.sources.libby,
      source: { kind: 'file-import', name: 'Libby timeline export' },
      externalKey: 'libby-loan-2026-cloud-cuckoo-land',
      observedAt: '2026-08-25T08:00:00.000Z',
      importedAt: recordedAt,
      claims: [],
      observedIdentifiers: [],
      rawPayload: { activity: 'Borrowed', format: 'Audiobook' },
    },
    {
      id: fixtureIds.sources.incorrectMetadata,
      source: { kind: 'metadata-provider', name: 'Google Books' },
      externalKey: 'google-volume-piranesi',
      observedAt: '2026-08-20T09:00:00.000Z',
      importedAt: '2026-08-20T09:01:00.000Z',
      claims: [
        {
          id: fixtureIds.claims.incorrectTitle,
          target: correctedTitleTarget,
          field: 'work.title',
          value: 'Piranezi',
          observedAt: '2026-08-20T09:00:00.000Z',
          confidence: 0.74,
        },
      ],
      observedIdentifiers: [],
      rawPayload: { title: 'Piranezi' },
    },
  ],
  metadataOverrides: [correctedTitleOverride],
  ownerships: [
    {
      id: ownershipIdSchema.parse('ownership:left-hand-ebook'),
      editionId: fixtureIds.editions.leftHandEbook,
      copyKind: 'drm-free-digital',
      acquisition: 'purchase',
      acquiredAt: '2026-01-10T12:00:00.000Z',
    },
  ],
  loans: [
    {
      id: loanIdSchema.parse('loan:libby:cloud-cuckoo-land'),
      editionId: fixtureIds.editions.libby,
      lenderName: 'Libby',
      borrowedAt: '2026-08-18T10:00:00.000Z',
      dueAt: '2026-09-01T10:00:00.000Z',
      renewalCount: 0,
      sourceRecordId: fixtureIds.sources.libby,
    },
  ],
  accessGrants: [
    {
      id: accessGrantIdSchema.parse('access:left-hand-owned'),
      editionId: fixtureIds.editions.leftHandEbook,
      basis: 'ownership',
      ownershipId: ownershipIdSchema.parse('ownership:left-hand-ebook'),
      createdAt: recordedAt,
    },
    {
      id: accessGrantIdSchema.parse('access:libby:cloud-cuckoo-land'),
      editionId: fixtureIds.editions.libby,
      basis: 'loan',
      loanId: loanIdSchema.parse('loan:libby:cloud-cuckoo-land'),
      createdAt: recordedAt,
    },
  ],
  people: [
    {
      id: fixtureIds.people.leGuin,
      displayName: localField(personRef(fixtureIds.people.leGuin), 'person.displayName', 'Ursula K. Le Guin'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.people.narrator,
      displayName: localField(personRef(fixtureIds.people.narrator), 'person.displayName', 'George Guidall'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.people.bulgakov,
      displayName: localField(personRef(fixtureIds.people.bulgakov), 'person.displayName', 'Mikhail Bulgakov'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.people.translator,
      displayName: localField(personRef(fixtureIds.people.translator), 'person.displayName', 'Richard Pevear'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
    {
      id: fixtureIds.people.tedChiang,
      displayName: localField(personRef(fixtureIds.people.tedChiang), 'person.displayName', 'Ted Chiang'),
      createdAt: recordedAt,
      updatedAt: recordedAt,
    },
  ],
  contributors: [
    {
      id: contributorIdSchema.parse('contributor:left-hand:author'),
      personId: fixtureIds.people.leGuin,
      target: workRef(fixtureIds.works.leftHand),
      role: 'author',
      creditedAs: 'Ursula K. Le Guin',
      position: 0,
    },
    {
      id: contributorIdSchema.parse('contributor:left-hand-audio:narrator'),
      personId: fixtureIds.people.narrator,
      target: editionRef(fixtureIds.editions.leftHandAudio),
      role: 'narrator',
      creditedAs: 'George Guidall',
      position: 0,
    },
    {
      id: contributorIdSchema.parse('contributor:master-and-margarita:author'),
      personId: fixtureIds.people.bulgakov,
      target: workRef(fixtureIds.works.masterAndMargarita),
      role: 'author',
      creditedAs: 'Mikhail Bulgakov',
      position: 0,
    },
    {
      id: contributorIdSchema.parse('contributor:master-and-margarita:translator'),
      personId: fixtureIds.people.translator,
      target: editionRef(fixtureIds.editions.translated),
      role: 'translator',
      creditedAs: 'Richard Pevear',
      position: 0,
    },
    {
      id: contributorIdSchema.parse('contributor:exhalation:author'),
      personId: fixtureIds.people.tedChiang,
      target: workRef(fixtureIds.works.anthology),
      role: 'author',
      creditedAs: 'Ted Chiang',
      position: 0,
    },
  ],
  workParts: [
    {
      id: workPartIdSchema.parse('work-part:exhalation:merchant'),
      containerWorkId: fixtureIds.works.anthology,
      workId: fixtureIds.works.anthologyStoryOne,
      position: 0,
    },
    {
      id: workPartIdSchema.parse('work-part:exhalation:story'),
      containerWorkId: fixtureIds.works.anthology,
      workId: fixtureIds.works.anthologyStoryTwo,
      position: 1,
    },
  ],
  progressSnapshots: [
    {
      id: progressSnapshotIdSchema.parse('progress:left-hand-ebook'),
      editionId: fixtureIds.editions.leftHandEbook,
      assetId: fixtureIds.assets.leftHandEpub,
      locator: { kind: 'epub', locator: 'epubcfi(/6/24!/4/2/14)' },
      normalizedProgress: 0.42,
      recordedAt,
    },
    {
      id: progressSnapshotIdSchema.parse('progress:left-hand-audio'),
      editionId: fixtureIds.editions.leftHandAudio,
      assetId: fixtureIds.assets.leftHandM4b,
      locator: { kind: 'audio-time', positionMs: 7_164_000 },
      normalizedProgress: 0.2,
      recordedAt,
    },
  ],
})
