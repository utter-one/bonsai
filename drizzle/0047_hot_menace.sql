-- Remove duplicate copy decorators, keeping the most recently updated row per (project_id, name)
DELETE FROM "copy_decorators"
WHERE
  ("project_id", "id") NOT IN (
    SELECT DISTINCT
      ON ("project_id", "name") "project_id",
      "id"
    FROM
      "copy_decorators"
    ORDER BY
      "project_id",
      "name",
      "updated_at" DESC
  );

CREATE UNIQUE INDEX "copy_decorators_project_id_name_unique" ON "copy_decorators" USING btree ("project_id", "name");
