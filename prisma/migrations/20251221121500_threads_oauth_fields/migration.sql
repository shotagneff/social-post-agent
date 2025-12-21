-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "threadsAccessToken" TEXT,
ADD COLUMN     "threadsUserId" TEXT,
ADD COLUMN     "threadsTokenExpiresAt" TIMESTAMP(3);
