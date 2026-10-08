-- AlterTable
ALTER TABLE `Transacao` ADD COLUMN `idLocal` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Transacao_tenantId_idLocal_key` ON `Transacao`(`tenantId`, `idLocal`);
