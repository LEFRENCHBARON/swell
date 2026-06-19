-- Seed: 22 surf spots (Hossegor → Hendaye, côte landaise + basque) + failure zones.
-- This data was lost when the historical migrations were squashed into the initial
-- schema; without it surf_spots is empty and NO board can be listed (spot_id is
-- required at POST /api/boards). Idempotent via ON CONFLICT (slug) DO NOTHING.

INSERT INTO surf_spots (name, slug, region, latitude, longitude, wave_type, level, description) VALUES
  ('La Nord (Hossegor)',          'la-nord-hossegor',        'hossegor',  43.6745, -1.4420, 'beach_break', 'expert',       'Le beach break le plus puissant d''Europe. Tubes creux, réservé aux surfeurs confirmés. Spot de la WSL.'),
  ('La Gravière (Hossegor)',      'la-graviere-hossegor',    'hossegor',  43.6695, -1.4410, 'beach_break', 'expert',       'Tubes parfaits et violents sur banc de sable creux. Une des vagues les plus réputées au monde.'),
  ('La Sud (Hossegor)',           'la-sud-hossegor',         'hossegor',  43.6620, -1.4395, 'beach_break', 'intermediate', 'Plus accessible que La Nord, vagues rapides et ludiques. Idéal niveau intermédiaire.'),
  ('Les Culs Nus (Seignosse)',    'les-culs-nus-seignosse',  'seignosse', 43.6870, -1.4445, 'beach_break', 'intermediate', 'Plage naturiste, vagues régulières et peu de monde en semaine.'),
  ('Les Bourdaines (Seignosse)',  'les-bourdaines-seignosse','seignosse', 43.6920, -1.4460, 'beach_break', 'intermediate', 'Beach break polyvalent, bons bancs de sable, fonctionne par petite à moyenne houle.'),
  ('Le Penon (Seignosse)',        'le-penon-seignosse',      'seignosse', 43.6990, -1.4470, 'beach_break', 'beginner',     'Vagues douces et longues plages, parfait pour débuter et progresser.'),
  ('Les Estagnots (Seignosse)',   'les-estagnots-seignosse', 'seignosse', 43.6950, -1.4465, 'beach_break', 'intermediate', 'Spot animé avec écoles de surf, vagues maniables.'),
  ('La Piste (Capbreton)',        'la-piste-capbreton',      'capbreton', 43.6480, -1.4470, 'beach_break', 'expert',       'Vague de bord rapide et creuse près de la digue, pour surfeurs aguerris.'),
  ('Le Santocha (Capbreton)',     'le-santocha-capbreton',   'capbreton', 43.6430, -1.4480, 'beach_break', 'intermediate', 'Spot central de Capbreton, vagues régulières et ambiance locale.'),
  ('Le Prevent (Capbreton)',      'le-prevent-capbreton',    'capbreton', 43.6450, -1.4475, 'beach_break', 'beginner',     'Vagues protégées par la digue, mer plus calme, bon pour débuter.'),
  ('VVF (Anglet)',                'vvf-anglet',              'anglet',    43.5180, -1.5320, 'beach_break', 'intermediate', 'Beach break d''Anglet exposé, bonne houle, fréquenté.'),
  ('Les Cavaliers (Anglet)',      'les-cavaliers-anglet',    'anglet',    43.5260, -1.5260, 'beach_break', 'intermediate', 'Spot historique du surf français, vagues puissantes, compétitions.'),
  ('La Petite Chambre d''Amour (Anglet)', 'petite-chambre-amour-anglet', 'anglet', 43.4920, -1.5440, 'beach_break', 'beginner', 'Crique abritée, vagues plus douces, idéal apprentissage.'),
  ('Marbella (Biarritz)',         'marbella-biarritz',       'biarritz',  43.4700, -1.5680, 'beach_break', 'intermediate', 'Plage du sud de Biarritz, vagues consistantes.'),
  ('La Grande Plage (Biarritz)',  'grande-plage-biarritz',   'biarritz',  43.4845, -1.5590, 'beach_break', 'beginner',     'Au cœur de Biarritz, vagues accessibles, cadre mythique.'),
  ('La Côte des Basques (Biarritz)','cote-des-basques-biarritz','biarritz',43.4790, -1.5650, 'beach_break', 'beginner',     'Berceau du surf européen, vagues longues à marée basse, parfait longboard et débutants.'),
  ('Ilbarritz (Bidart)',          'ilbarritz-bidart',        'bidart',    43.4530, -1.5830, 'beach_break', 'intermediate', 'Spot panoramique, vagues variées selon la houle.'),
  ('Bidart Centre',               'bidart-centre',           'bidart',    43.4380, -1.5920, 'beach_break', 'intermediate', 'Plages de Bidart, beach breaks réguliers.'),
  ('Guéthary (Parlementia)',      'guethary-parlementia',    'guethary',  43.4220, -1.6090, 'reef_break',  'advanced',     'Vague de récif puissante au large, droite longue par grosse houle. Niveau confirmé.'),
  ('Lafitenia (Saint-Jean-de-Luz)','lafitenia-sjdl',         'saint-jean-de-luz', 43.4010, -1.6420, 'point_break', 'intermediate', 'Point break en baie, droite longue et enroulée, l''une des plus belles vagues du Pays basque.'),
  ('Erromardie (Saint-Jean-de-Luz)','erromardie-sjdl',       'saint-jean-de-luz', 43.4050, -1.6580, 'beach_break', 'beginner',     'Baie abritée, vagues douces, familial.'),
  ('Hendaye Plage',               'hendaye-plage',           'hendaye',   43.3720, -1.7780, 'beach_break', 'beginner',     'Grande plage abritée, vagues les plus douces de la côte, idéale débutants et écoles.')
ON CONFLICT (slug) DO NOTHING;

-- Failure zones (SWELL_FAILURE_ATLAS) for the higher-risk spots.
INSERT INTO failure_zones (spot_id, zone_name, damage_multiplier, rider_level_warning, dominant_damage_types, worst_board_types, recommended_board_types, incident_count, avg_repair_cost_cents, data_source)
SELECT s.id, z.zone_name, z.damage_multiplier, z.rider_level_warning, z.dominant_damage_types::jsonb, z.worst_board_types::jsonb, z.recommended_board_types::jsonb, z.incident_count, z.avg_repair_cost_cents, 'expert'
FROM (VALUES
  ('la-nord-hossegor',       'La Nord — zone à fort impact',     2.50, 'expert',       '["nose_break","rail_ding","snap"]', '["longboard","fish_soft"]', '["shortboard_epoxy","step_up"]', 0, 12000),
  ('la-graviere-hossegor',   'La Gravière — tubes creux',        2.30, 'expert',       '["snap","nose_break","fin_box"]',  '["longboard","soft_top"]', '["shortboard_epoxy","gun"]',     0, 11000),
  ('la-piste-capbreton',     'La Piste — shore break digue',     2.00, 'advanced',     '["rail_ding","nose_break"]',       '["longboard"]',            '["shortboard_epoxy"]',           0,  9000),
  ('guethary-parlementia',   'Parlementia — récif',              1.80, 'advanced',     '["fin_box","rail_ding","ding_bottom"]', '["soft_top"]',        '["gun","step_up"]',              0,  9500),
  ('les-cavaliers-anglet',   'Les Cavaliers — houle puissante',  1.50, 'intermediate', '["rail_ding","nose_break"]',       '["soft_top"]',             '["shortboard_epoxy","hybrid"]',  0,  7000),
  ('la-sud-hossegor',        'La Sud — beach break rapide',      1.40, 'intermediate', '["rail_ding"]',                    '[]',                       '["hybrid","shortboard_epoxy"]',  0,  6000),
  ('lafitenia-sjdl',         'Lafitenia — rochers en sortie',    1.30, 'intermediate', '["ding_bottom","fin_box"]',        '[]',                       '["funboard","longboard_epoxy"]', 0,  6500)
) AS z(slug, zone_name, damage_multiplier, rider_level_warning, dominant_damage_types, worst_board_types, recommended_board_types, incident_count, avg_repair_cost_cents)
JOIN surf_spots s ON s.slug = z.slug
WHERE NOT EXISTS (SELECT 1 FROM failure_zones fz WHERE fz.spot_id = s.id);
