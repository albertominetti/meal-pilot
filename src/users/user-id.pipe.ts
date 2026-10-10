import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { USER_ID_PATTERN } from '../meal-plan/dto/meal-plan-request.dto';

/** Opaque JJFit ids: letters, digits, "_" and "-", at most 128 characters. */
@Injectable()
export class UserIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!USER_ID_PATTERN.test(value)) throw new BadRequestException('Invalid userId');
    return value;
  }
}
