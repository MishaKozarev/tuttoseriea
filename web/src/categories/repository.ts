import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { categoryId, categoryKind, CategoryError, parseCategoryWrite, type Category, type CategoryKind, type CategoryPage, type CategoryQuery } from "./management";
type Queryable = Pick<Pool | PoolClient, "query">;
type Row = { id: string; name: string; revision: number; created_at: Date | string; updated_at: Date | string };
const project = (r: Row): Category => ({ id: r.id, name: r.name, revision: r.revision,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() });

// Independent repositories select their own domain table. No content or generic taxonomy CRUD.
export class CategoryRepository {
  private readonly table: string;
  constructor(private readonly db: Queryable, kind: CategoryKind) { this.table = `${categoryKind(kind)}.categories`; }
  async list(filter: CategoryQuery): Promise<CategoryPage> {
    const pattern = `%${filter.query.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
    const row = (await this.db.query<{ total: number; items: Row[] }>(`with filtered as materialized (
      select * from ${this.table} where name ilike $1 escape '!'
    ), page as (select * from filtered order by lower(name),id limit 20 offset $2)
    select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(p order by lower(p.name),p.id) from page p),'[]'::jsonb) as items`, [pattern, (filter.page - 1) * 20])).rows[0];
    return { items: row.items.map(project), total: row.total, page: filter.page, totalPages: Math.ceil(row.total / 20) };
  }
  async get(id: string): Promise<Category | null> {
    const row = (await this.db.query<Row>(`select * from ${this.table} where id=$1`, [categoryId(id)])).rows[0];
    return row ? project(row) : null;
  }
  async create(input: unknown): Promise<Category> {
    const { name } = parseCategoryWrite(input, "create");
    try { return project((await this.db.query<Row>(`insert into ${this.table}(id,name) values($1,$2) returning *`, [randomUUID(), name])).rows[0]); }
    catch (error) { return this.classify(error); }
  }
  async edit(id: string, input: unknown): Promise<Category> {
    const { name, expectedRevision } = parseCategoryWrite(input, "edit");
    try {
      const row = (await this.db.query<Row>(`update ${this.table} set name=$2,revision=revision+1,updated_at=now()
        where id=$1 and revision=$3 returning *`, [categoryId(id), name, expectedRevision])).rows[0];
      if (row) return project(row);
    } catch (error) { return this.classify(error); }
    return this.missingOrConflict(id);
  }
  async delete(id: string, input: unknown): Promise<void> {
    const { expectedRevision } = parseCategoryWrite(input, "delete");
    try {
      const result = await this.db.query(`delete from ${this.table} where id=$1 and revision=$2 returning id`, [categoryId(id), expectedRevision]);
      if (result.rows.length) return;
    } catch (error) { return this.classify(error); }
    return this.missingOrConflict(id);
  }
  private async missingOrConflict(id: string): Promise<never> {
    if (!await this.get(id)) throw new CategoryError("NOT_FOUND", 404, "Category not found");
    throw new CategoryError("CATEGORY_CONFLICT", 409, "Category changed; reload before editing or deleting");
  }
  private classify(error: unknown): never {
    const code = (error as { code?: string })?.code;
    if (code === "23505") throw new CategoryError("CATEGORY_NAME_CONFLICT", 409, "Category name already exists");
    if (code === "23503" || code === "23001") throw new CategoryError("CATEGORY_IN_USE", 409, "Category is referenced by content and cannot be deleted");
    throw error;
  }
}
export class ArticleCategoryRepository extends CategoryRepository { constructor(db: Queryable) { super(db, "article"); } }
export class NewsCategoryRepository extends CategoryRepository { constructor(db: Queryable) { super(db, "news"); } }
