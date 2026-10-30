📂 Schéma Relationnel over Supabase 
Tables & Types

• player : id (PK, int2) | name (text) | email (text) | groupId (FK, int2)
• group : id (PK, int2) | name (text)
• ClickerCompetition : id (PK, int8) | created_at (timestamp) | author_id (FK, int2)
• clicker_game_settings : id (PK, bool) | bonus_min_clicks (int4) | bonus_max_clicks (int4) | family_coefficient_per... (numeric)
• debug : is_debug (PK, bool)

Relations

• player.groupId ➔ group.id (N:1)
• ClickerCompetition.author_id ➔ player.id (N:1)
