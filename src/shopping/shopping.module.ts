import { Module } from '@nestjs/common';
import { VideosModule } from '../videos/videos.module';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListService } from './shopping-list.service';

@Module({
  imports: [VideosModule],
  controllers: [ShoppingListController],
  providers: [ShoppingListService],
})
export class ShoppingModule {}
