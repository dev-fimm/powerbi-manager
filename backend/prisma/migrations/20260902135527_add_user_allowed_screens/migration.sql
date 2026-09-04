-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allowed_screens" TEXT[] DEFAULT ARRAY[]::TEXT[];
