-- CreateTable
CREATE TABLE `MovimentacaoEstoque` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `produtoId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('INICIAL', 'ENTRADA', 'VENDA', 'ESTORNO', 'AJUSTE') NOT NULL,
    `quantidade` INTEGER NOT NULL,
    `saldoApos` INTEGER NOT NULL,
    `motivo` VARCHAR(191) NULL,
    `usuarioId` VARCHAR(191) NULL,
    `referenciaId` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MovimentacaoEstoque_produtoId_criadoEm_idx`(`produtoId`, `criadoEm`),
    INDEX `MovimentacaoEstoque_tenantId_criadoEm_idx`(`tenantId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MovimentacaoEstoque` ADD CONSTRAINT `MovimentacaoEstoque_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimentacaoEstoque` ADD CONSTRAINT `MovimentacaoEstoque_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
