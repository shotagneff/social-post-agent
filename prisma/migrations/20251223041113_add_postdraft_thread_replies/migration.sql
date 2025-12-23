-- AlterTable
ALTER TABLE "CollectedPost" ALTER COLUMN "metrics" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "raw" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "Draft" ALTER COLUMN "variants" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "formatted" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "PostDraft" ADD COLUMN     "threadReplies" JSONB;

-- AlterTable
ALTER TABLE "PublishedPost" ALTER COLUMN "raw" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "WorkspaceSettings" ALTER COLUMN "postingTargets" SET DEFAULT '[]'::jsonb,
ALTER COLUMN "schedulingPolicy" SET DEFAULT '{}'::jsonb;
