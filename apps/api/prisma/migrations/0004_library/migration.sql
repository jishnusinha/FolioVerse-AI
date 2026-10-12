-- CreateEnum
CREATE TYPE "ReadingStatus" AS ENUM ('TO_READ', 'READING', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MetadataSource" AS ENUM ('MANUAL', 'EPUB', 'OPEN_LIBRARY', 'GOOGLE_BOOKS');

-- CreateEnum
CREATE TYPE "AnnotationKind" AS ENUM ('HIGHLIGHT', 'NOTE');

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT,
    "publisher" TEXT,
    "published_year" INTEGER,
    "isbn_13" TEXT,
    "description" TEXT,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "page_count" INTEGER,
    "cover_url" TEXT,
    "cover_tone" INTEGER NOT NULL DEFAULT 1,
    "metadata_source" "MetadataSource" NOT NULL DEFAULT 'MANUAL',
    "external_ids" JSONB NOT NULL DEFAULT '{}',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "source_id" UUID,
    "status" "ReadingStatus" NOT NULL DEFAULT 'TO_READ',
    "rating" INTEGER,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "collection_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collection_id","item_id")
);

-- CreateTable
CREATE TABLE "reading_progress" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "locator" JSONB NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chapter_index" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reading_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "source_version_id" UUID,
    "kind" "AnnotationKind" NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'amber',
    "locator" JSONB NOT NULL,
    "quote" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "locator" JSONB NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_metadata_cache" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_metadata_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "books_workspace_id_isbn_13_idx" ON "books"("workspace_id", "isbn_13");

-- CreateIndex
CREATE INDEX "library_items_workspace_id_user_id_status_idx" ON "library_items"("workspace_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "library_items_user_id_book_id_key" ON "library_items"("user_id", "book_id");

-- CreateIndex
CREATE UNIQUE INDEX "collections_workspace_id_user_id_name_key" ON "collections"("workspace_id", "user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "reading_progress_item_id_key" ON "reading_progress"("item_id");

-- CreateIndex
CREATE INDEX "reading_sessions_workspace_id_user_id_day_idx" ON "reading_sessions"("workspace_id", "user_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "reading_sessions_item_id_day_key" ON "reading_sessions"("item_id", "day");

-- CreateIndex
CREATE INDEX "annotations_item_id_updated_at_idx" ON "annotations"("item_id", "updated_at");

-- CreateIndex
CREATE INDEX "bookmarks_item_id_idx" ON "bookmarks"("item_id");

-- AddForeignKey
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
