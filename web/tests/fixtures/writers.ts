import type { WriterAdminDTO, WriterProfileDTO } from "@/src/identity/writer-contract";

export function writerProfileFixture(overrides: Partial<WriterProfileDTO> = {}): WriterProfileDTO {
  return { accountId: "writer-account", nickname: "Автор", socialLinks: [], avatarMediaId: null, avatarUrl: null, revision: 1, canPublishOwn: false, publicationRevision: 0, ...overrides };
}

export function writerAdminFixture(overrides: Partial<WriterAdminDTO> = {}): WriterAdminDTO {
  return { accountId: "writer-account", email: "writer@example.invalid", roles: ["writer"], status: "active", profile: writerProfileFixture(), canPublishOwn: false, publicationRevision: 0, isWriter: true, ...overrides };
}
