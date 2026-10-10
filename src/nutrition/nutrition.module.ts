import { Module, Provider } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import {
  FDC_MAPPING_STORE,
  FdcMappingStore,
  FileFdcMappingStore,
  PgFdcMappingStore,
} from './fdc-mapping.store';
import { FDC_CLIENT, HttpFdcClient } from './fdc.client';
import { NutritionService } from './nutrition.service';

const mappingStoreProvider: Provider = {
  provide: FDC_MAPPING_STORE,
  useFactory: (database: DatabaseService): FdcMappingStore =>
    database.enabled ? new PgFdcMappingStore(database) : new FileFdcMappingStore(),
  inject: [DatabaseService],
};

@Module({
  providers: [
    { provide: FDC_CLIENT, useClass: HttpFdcClient },
    mappingStoreProvider,
    {
      provide: NutritionService,
      useFactory: (client, store) => new NutritionService(client, store),
      inject: [FDC_CLIENT, FDC_MAPPING_STORE],
    },
  ],
  exports: [NutritionService],
})
export class NutritionModule {}
