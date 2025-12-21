-- CreateEnum
CREATE TYPE "PostDraftStatus" AS ENUM ('DRAFT_GENERATED', 'TEMP_SCHEDULED', 'CONFIRMED', 'POSTING', 'POSTED', 'SKIPPED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "CollectedPost" ALTER COLUMN "metrics" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "raw" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "Draft" ALTER COLUMN "variants" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "formatted" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "PublishedPost" ALTER COLUMN "raw" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "postDraftId" TEXT,
ADD COLUMN     "slotId" TEXT,
ALTER COLUMN "draftId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "schedulingPolicy" JSONB NOT NULL DEFAULT '{}'::jsonb,
ALTER COLUMN "postingTargets" SET DEFAULT '[]'::jsonb;

-- CreateTable
CREATE TABLE "PostDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "draftId" TEXT,
    "platform" "Platform" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PostDraftStatus" NOT NULL DEFAULT 'DRAFT_GENERATED',
    "tempScheduledAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingSlot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedPostDraftId" TEXT,

    CONSTRAINT "SchedulingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostDraft_workspaceId_platform_createdAt_idx" ON "PostDraft"("workspaceId", "platform", "createdAt");

-- CreateIndex
CREATE INDEX "PostDraft_status_createdAt_idx" ON "PostDraft"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingSlot_assignedPostDraftId_key" ON "SchedulingSlot"("assignedPostDraftId");

-- CreateIndex
CREATE INDEX "SchedulingSlot_workspaceId_platform_scheduledAt_idx" ON "SchedulingSlot"("workspaceId", "platform", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingSlot_workspaceId_platform_scheduledAt_key" ON "SchedulingSlot"("workspaceId", "platform", "scheduledAt");

-- CreateIndex
CREATE INDEX "Schedule_isConfirmed_status_scheduledAt_idx" ON "Schedule"("isConfirmed", "status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "PostDraft" ADD CONSTRAINT "PostDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDraft" ADD CONSTRAINT "PostDraft_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingSlot" ADD CONSTRAINT "SchedulingSlot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingSlot" ADD CONSTRAINT "SchedulingSlot_assignedPostDraftId_fkey" FOREIGN KEY ("assignedPostDraftId") REFERENCES "PostDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_postDraftId_fkey" FOREIGN KEY ("postDraftId") REFERENCES "PostDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "SchedulingSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
