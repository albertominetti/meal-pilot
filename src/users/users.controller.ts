import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MealLogDto, ProfileDto } from './dto/user-data.dto';
import { ProfilesService } from './profiles.service';

/** Demo mode: one implicit user, so no user id in the paths. */
@ApiTags('profile')
@Controller()
export class UsersController {
  constructor(private readonly profiles: ProfilesService) {}

  @Put('profile')
  @ApiOperation({ summary: 'Store the health profile (requires consent: true); meal plans then use it automatically' })
  putProfile(@Body() dto: ProfileDto) {
    return this.profiles.put(dto);
  }

  @Get('profile')
  getProfile() {
    return this.profiles.get();
  }

  @Delete('profile')
  @ApiOperation({ summary: 'Erase the profile, every saved plan and the meal log' })
  deleteProfile() {
    return this.profiles.delete();
  }

  @Post('meals')
  @ApiOperation({ summary: 'Log a cooked meal and an optional 1-5 rating; ratings steer later plans' })
  addMeal(@Body() dto: MealLogDto) {
    return this.profiles.addMeal(dto);
  }

  @Get('meals')
  listMeals() {
    return this.profiles.listMeals();
  }
}
