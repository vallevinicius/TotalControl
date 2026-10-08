-- AlterTable
ALTER TABLE `LancamentoFinanceiro`
    ADD COLUMN `vencimento` DATETIME(3) NULL,
    ADD COLUMN `pagoEm` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `LancamentoFinanceiro_tenantId_vencimento_idx` ON `LancamentoFinanceiro`(`tenantId`, `vencimento`);
