import { Module } from '@nestjs/common';
import { WalService } from './wal.service';

@Module({
  providers: [WalService],
  exports: [WalService],
})
export class WalModule {}
