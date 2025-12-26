-- AlterTable
ALTER TABLE "CollectedPost" ALTER COLUMN "metrics" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "raw" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "Draft" ALTER COLUMN "variants" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "formatted" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "PublishedPost" ALTER COLUMN "raw" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "WorkspaceSettings" ALTER COLUMN "postingTargets" SET DEFAULT '[]'::jsonb,
ALTER COLUMN "schedulingPolicy" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "themesByPlatform" SET DEFAULT '{}'::jsonb;

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceDocId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chunkKey" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "sourceUrl" TEXT,
    "sourceDocId" TEXT,
    "sourceFolderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeSource_workspaceId_updatedAt_idx" ON "KnowledgeSource"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_workspaceId_key_key" ON "KnowledgeSource"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "PrimaryChunk_workspaceId_kind_isActive_idx" ON "PrimaryChunk"("workspaceId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "PrimaryChunk_workspaceId_updatedAt_idx" ON "PrimaryChunk"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryChunk_workspaceId_chunkKey_key" ON "PrimaryChunk"("workspaceId", "chunkKey");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryChunk" ADD CONSTRAINT "PrimaryChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
