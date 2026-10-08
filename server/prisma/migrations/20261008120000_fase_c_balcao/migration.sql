-- AlterTable
ALTER TABLE `Usuario` ADD COLUMN `acoes` JSON NULL;

-- AlterTable
ALTER TABLE `Transacao`
    ADD COLUMN `cancelada` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `canceladaEm` DATETIME(3) NULL,
    ADD COLUMN `canceladaPorId` VARCHAR(191) NULL,
    ADD COLUMN `motivoCancelamento` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Produto` ADD COLUMN `codigoBarras` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Produto_tenantId_codigoBarras_idx` ON `Produto`(`tenantId`, `codigoBarras`);

-- CreateTable
CREATE TABLE `PagamentoVenda` (
    `id` VARCHAR(191) NOT NULL,
    `transacaoId` VARCHAR(191) NOT NULL,
    `forma` ENUM('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'BOLETO', 'OUTRO') NOT NULL,
    `valor` DECIMAL(12, 2) NOT NULL,
    `parcelas` INTEGER NOT NULL DEFAULT 1,

    INDEX `PagamentoVenda_transacaoId_idx`(`transacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MovimentoCaixa` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `caixaId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('SANGRIA', 'SUPRIMENTO') NOT NULL,
    `valor` DECIMAL(12, 2) NOT NULL,
    `motivo` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MovimentoCaixa_caixaId_idx`(`caixaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PagamentoVenda` ADD CONSTRAINT `PagamentoVenda_transacaoId_fkey` FOREIGN KEY (`transacaoId`) REFERENCES `Transacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimentoCaixa` ADD CONSTRAINT `MovimentoCaixa_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimentoCaixa` ADD CONSTRAINT `MovimentoCaixa_caixaId_fkey` FOREIGN KEY (`caixaId`) REFERENCES `Caixa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
