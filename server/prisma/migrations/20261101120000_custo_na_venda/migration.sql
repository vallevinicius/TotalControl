-- Custo do produto gravado em cada item vendido (lucro histórico estável).
ALTER TABLE `ItemTransacao` ADD COLUMN `custoUnitario` DECIMAL(12, 2) NULL;
