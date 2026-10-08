-- AlterTable
ALTER TABLE `Empresa` ADD COLUMN `avisosEmail` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `AvisoEnviado` (
    `id` VARCHAR(191) NOT NULL,
    `empresaId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `chave` VARCHAR(191) NOT NULL,
    `enviadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AvisoEnviado_empresaId_tipo_chave_key`(`empresaId`, `tipo`, `chave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AvisoEnviado` ADD CONSTRAINT `AvisoEnviado_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `Empresa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
