import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserIdPipe } from './user-id.pipe';
import { MealLogDto, ProfileDto } from './dto/user-data.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('users')
@Controller('users/:userId')
export class UsersController {
  constructor(private readonly profiles: ProfilesService) {}

  @Put('profile')
  @ApiOperation({ summary: 'Store the health profile (requires consent: true)' })
  putProfile(@Param('userId', UserIdPipe) userId: string, @Body() dto: ProfileDto) {
    return this.profiles.put(userId, dto);
  }

  @Get('profile')
  getProfile(@Param('userId', UserIdPipe) userId: string) {
    return this.profiles.get(userId);
  }

  @Delete('profile')
  @ApiOperation({ summary: 'Erase the profile, every saved plan and the meal log of this user' })
  deleteProfile(@Param('userId', UserIdPipe) userId: string) {
    return this.profiles.delete(userId);
  }

  @Post('meals')
  @ApiOperation({ summary: 'Log a cooked meal and an optional 1-5 rating; ratings steer later plans' })
  addMeal(@Param('userId', UserIdPipe) userId: string, @Body() dto: MealLogDto) {
    return this.profiles.addMeal(userId, dto);
  }

  @Get('meals')
  listMeals(@Param('userId', UserIdPipe) userId: string) {
    return this.profiles.listMeals(userId);
  }
}
