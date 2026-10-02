import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { DomainError } from './errors';

export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ example: 'createdAt:desc' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]+:(asc|desc)$/)
  sort?: string;
}

export class Paged<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: { page: number; pageSize: number; total: number; totalPages: number },
  ) {}
}

export function paged<T>(items: T[], total: number, q: PageQuery): Paged<T> {
  return new Paged(items, { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
}

export function skipTake(q: PageQuery): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

/** Sort fields are whitelisted so a query parameter can never name an arbitrary column. */
export function orderBy<F extends string>(sort: string | undefined, allowed: readonly F[], fallback: Record<string, 'asc' | 'desc'>) {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':') as [F, 'asc' | 'desc'];
  if (!allowed.includes(field)) throw new DomainError('VALIDATION_ERROR', `Cannot sort by "${field}".`, [{ field: 'sort', message: `Allowed: ${allowed.join(', ')}` }]);
  return { [field]: dir } as Record<string, 'asc' | 'desc'>;
}
