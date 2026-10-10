import { Module, Provider } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { ProfilesService } from './profiles.service';
import { FileUserDataStore, PgUserDataStore, USER_DATA_STORE, UserDataStore } from './user-data.store';
import { UsersController } from './users.controller';

const userDataStoreProvider: Provider = {
  provide: USER_DATA_STORE,
  useFactory: (database: DatabaseService): UserDataStore =>
    database.enabled ? new PgUserDataStore(database) : new FileUserDataStore(),
  inject: [DatabaseService],
};

@Module({
  controllers: [UsersController],
  providers: [userDataStoreProvider, ProfilesService],
  exports: [USER_DATA_STORE, ProfilesService],
})
export class UsersModule {}
