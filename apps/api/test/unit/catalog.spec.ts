import { CatalogRecord, loadCatalog } from '../../src/modules/discovery/catalog';

describe('catalog importer flags (FV-G13-SEED-005)', () => {
  const sampleRecords: CatalogRecord[] = [
    {
      id: '01918a20-0000-7000-8000-000000000001',
      slug: 'solar-echoes',
      kind: 'BOOK',
      title: 'Solar Echoes',
      creators: ['Arthur Vance'],
      genres: ['Sci-fi'],
      moods: ['Atmospheric'],
      themes: [{ name: 'memory', weight: 0.9 }],
      description: 'A novel about space exploration and memories.',
      quality: 4.5,
      popularity: 0.8,
      coverTone: 1,
      isDemo: true,
    },
    {
      id: '01918a20-0000-7000-8000-000000000002',
      slug: 'deep-orbit',
      kind: 'BOOK',
      title: 'Deep Orbit (Updated)',
      creators: ['Arthur Vance'],
      genres: ['Sci-fi'],
      moods: ['Tense'],
      themes: [{ name: 'survival', weight: 0.8 }],
      description: 'A harrowing journey in deep space.',
      quality: 4.0,
      popularity: 0.6,
      coverTone: 2,
      isDemo: true,
    },
  ];

  it('respects dryRun: true without committing writes', async () => {
    const existing = [
      {
        id: '01918a20-0000-7000-8000-000000000002',
        slug: 'deep-orbit',
        kind: 'BOOK',
        title: 'Deep Orbit',
        creators: ['Arthur Vance'],
        genres: ['Sci-fi'],
        moods: ['Tense'],
        themes: [{ theme: 'survival', weight: 0.5 }],
        description: 'An old description',
        quality: 3.5,
        popularity: 0.5,
        coverTone: 2,
        isDemo: true,
      },
    ];

    const prismaMock: any = {
      catalogItem: {
        findMany: jest.fn().mockResolvedValue(existing),
        createMany: jest.fn(),
        update: jest.fn(),
      },
      itemTheme: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const result = await loadCatalog(prismaMock, sampleRecords, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.total).toBe(2);
    expect(result.created).toBe(1); // solar-echoes is fresh
    expect(result.updated).toBe(1); // deep-orbit is changed
    expect(result.skipped).toBe(0);

    // Verify no DB mutations occurred
    expect(prismaMock.catalogItem.createMany).not.toHaveBeenCalled();
    expect(prismaMock.catalogItem.update).not.toHaveBeenCalled();
    expect(prismaMock.itemTheme.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.itemTheme.createMany).not.toHaveBeenCalled();
  });

  it('respects onConflict: skip by not updating existing items', async () => {
    const existing = [
      {
        id: '01918a20-0000-7000-8000-000000000002',
        slug: 'deep-orbit',
        kind: 'BOOK',
        title: 'Deep Orbit',
        creators: ['Arthur Vance'],
        genres: ['Sci-fi'],
        moods: ['Tense'],
        themes: [{ theme: 'survival', weight: 0.5 }],
        description: 'An old description',
        quality: 3.5,
        popularity: 0.5,
        coverTone: 2,
        isDemo: true,
      },
    ];

    const prismaMock: any = {
      catalogItem: {
        findMany: jest.fn().mockResolvedValue(existing),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      itemTheme: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const result = await loadCatalog(prismaMock, sampleRecords, { onConflict: 'skip' });
    expect(result.dryRun).toBe(false);
    expect(result.total).toBe(2);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);

    expect(prismaMock.catalogItem.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.catalogItem.update).not.toHaveBeenCalled();
  });

  it('respects onConflict: replace by updating changed items', async () => {
    const existing = [
      {
        id: '01918a20-0000-7000-8000-000000000002',
        slug: 'deep-orbit',
        kind: 'BOOK',
        title: 'Deep Orbit',
        creators: ['Arthur Vance'],
        genres: ['Sci-fi'],
        moods: ['Tense'],
        themes: [{ theme: 'survival', weight: 0.5 }],
        description: 'An old description',
        quality: 3.5,
        popularity: 0.5,
        coverTone: 2,
        isDemo: true,
      },
    ];

    const prismaMock: any = {
      catalogItem: {
        findMany: jest.fn().mockResolvedValue(existing),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockReturnValue('update_op'),
      },
      itemTheme: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        deleteMany: jest.fn().mockReturnValue('delete_op'),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const result = await loadCatalog(prismaMock, sampleRecords, { onConflict: 'replace' });
    expect(result.dryRun).toBe(false);
    expect(result.total).toBe(2);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);

    expect(prismaMock.catalogItem.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.itemTheme.createMany).toHaveBeenCalledTimes(1);
  });
});
