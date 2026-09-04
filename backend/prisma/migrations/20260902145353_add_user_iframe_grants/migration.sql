-- CreateTable
CREATE TABLE "user_iframes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "iframe_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_iframes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_iframes_user_id_idx" ON "user_iframes"("user_id");

-- CreateIndex
CREATE INDEX "user_iframes_iframe_id_idx" ON "user_iframes"("iframe_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_iframes_user_id_iframe_id_key" ON "user_iframes"("user_id", "iframe_id");

-- AddForeignKey
ALTER TABLE "user_iframes" ADD CONSTRAINT "user_iframes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_iframes" ADD CONSTRAINT "user_iframes_iframe_id_fkey" FOREIGN KEY ("iframe_id") REFERENCES "iframes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
