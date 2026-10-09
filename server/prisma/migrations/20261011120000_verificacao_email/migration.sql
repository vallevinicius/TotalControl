-- AlterTable
ALTER TABLE `Usuario` ADD COLUMN `emailPendente` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `TokenVerificacaoEmail` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiraEm` DATETIME(3) NOT NULL,
    `usadoEm` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TokenVerificacaoEmail_tokenHash_key`(`tokenHash`),
    INDEX `TokenVerificacaoEmail_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TokenVerificacaoEmail` ADD CONSTRAINT `TokenVerificacaoEmail_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
