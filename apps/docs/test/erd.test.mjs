import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { erdSvg, modelTable, parsePrisma, relations } from '../scripts/lib/erd.mjs';

const SAMPLE = `
enum Role {
  OWNER
  VIEWER

  @@schema("app")
}

/// A shared space.
model Workspace {
  id      String   @id @db.Uuid
  name    String
  members Member[]

  @@map("workspaces")
  @@schema("app")
}

model Member {
  workspaceId String    @map("workspace_id") @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  role        Role
  note        String? // free text
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@id([workspaceId, userId])
  @@schema("app")
}

model Loose {
  id   String @id
  tags String[]

  @@schema("app")
}
`;

test('parsePrisma reads models, keys, relations, enums and schemas', () => {
  const { models, enums } = parsePrisma(SAMPLE);
  assert.deepEqual(enums, [{ name: 'Role', schema: 'app', values: ['OWNER', 'VIEWER'] }]);
  assert.deepEqual(models.map((m) => [m.name, m.table, m.schema]), [
    ['Workspace', 'workspaces', 'app'],
    ['Member', 'Member', 'app'],
    ['Loose', 'Loose', 'app'],
  ]);
  const [ws, member, loose] = models;
  assert.equal(ws.doc, 'A shared space.');
  assert.equal(ws.fields.find((f) => f.name === 'members').kind, 'relation');
  assert.deepEqual(member.compositeId, ['workspaceId', 'userId']);
  assert.equal(member.fields.find((f) => f.name === 'role').kind, 'enum');
  assert.equal(member.fields.find((f) => f.name === 'note').optional, true);
  assert.equal(member.fields.find((f) => f.name === 'note').attrs, '');
  assert.equal(loose.fields.find((f) => f.name === 'tags').list, true);
  assert.deepEqual(relations(models), [{ from: 'Member', to: 'Workspace', field: 'workspace', fields: ['workspaceId'], optional: false }]);
});

test('erdSvg draws every model and declared relation without blank lines', () => {
  const { models } = parsePrisma(SAMPLE);
  const svg = erdSvg(models, { id: 'erd-t', title: 'Test <schema>', href: (m) => `#${m.name.toLowerCase()}` });
  assert.doesNotMatch(svg, /\n\s*\n/);
  assert.equal((svg.match(/class="erd-node"/g) ?? []).length, 3);
  assert.equal((svg.match(/class="erd-edge"/g) ?? []).length, 1);
  assert.match(svg, /<title id="erd-t-title">Test &lt;schema&gt;<\/title>/);
  assert.match(svg, /href="#member"/);
  assert.match(svg, /PK <\/tspan>workspaceId: String/);
});

test('modelTable marks keys and links relations', () => {
  const { models } = parsePrisma(SAMPLE);
  const table = modelTable(models[1], { anchor: (n) => n.toLowerCase() });
  assert.match(table, /\| `workspaceId` \| `String` \| PK, FK \|/);
  assert.match(table, /\| `workspace` \| \[Workspace\]\(#workspace\) \|/);
});

test('the real Prisma schema parses into the app, ai and rec schemas', () => {
  const text = readFileSync(new URL('../../api/prisma/schema.prisma', import.meta.url), 'utf8');
  const { models, enums } = parsePrisma(text);
  const declared = (text.match(/^model \w+ \{/gm) ?? []).length;
  assert.equal(models.length, declared);
  assert.equal(enums.length, (text.match(/^enum \w+ \{/gm) ?? []).length);
  assert.deepEqual([...new Set(models.map((m) => m.schema))].sort(), ['ai', 'app', 'rec']);
  const names = new Set(models.map((m) => m.name));
  for (const r of relations(models)) assert.ok(names.has(r.to), `${r.from}.${r.field} -> ${r.to}`);
});
