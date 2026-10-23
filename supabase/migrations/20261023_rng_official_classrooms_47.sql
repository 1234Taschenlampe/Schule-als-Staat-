-- Official RNG campus PDF, edition June 2024, seven pages.
-- Exact room labels were extracted from the classified 'Klassenraum' entries,
-- and pin coordinates from the printed, left-hand floorplan, NOT the legend.
-- E101 etc. are on the Erdgeschoss page despite the E1xx numbering.
-- Specialty rooms, stairs, offices, bio/chemistry/physics/music/art rooms excluded.
-- D102 is confirmed as Klassenraum but lacks a separately selectable map label:
-- keep its pin coords null rather than invent geometry.
insert into public.school_places
(name,kind,floor_label,detail,x_percent,y_percent,plan_page,classroom_shop_enabled,active)
values
('A003', 'room', 'Gebäude A · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 41.63, 64.41, 4, TRUE, TRUE),
('A006', 'room', 'Gebäude A · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 41.5, 57.31, 4, TRUE, TRUE),
('A007', 'room', 'Gebäude A · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 41.49, 52.8, 4, TRUE, TRUE),
('A008', 'room', 'Gebäude A · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 41.49, 48.28, 4, TRUE, TRUE),
('C002', 'room', 'Gebäude C · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 45.63, 40.47, 4, TRUE, TRUE),
('C003', 'room', 'Gebäude C · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 51.33, 40.47, 4, TRUE, TRUE),
('E101', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 41.97, 88.9, 4, TRUE, TRUE),
('E103', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 42.91, 94.49, 4, TRUE, TRUE),
('E104', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 48.03, 93.12, 4, TRUE, TRUE),
('E105', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 48.02, 89, 4, TRUE, TRUE),
('E106', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 48.14, 83.83, 4, TRUE, TRUE),
('E107', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 48.14, 79.49, 4, TRUE, TRUE),
('E109', 'room', 'Gebäude E · Erdgeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 4.', 41.95, 80.87, 4, TRUE, TRUE),
('D102', 'room', 'Gebäude D · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', NULL, NULL, 5, TRUE, TRUE),
('D103', 'room', 'Gebäude D · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 30.23, 20.85, 5, TRUE, TRUE),
('D104', 'room', 'Gebäude D · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 34.57, 15.57, 5, TRUE, TRUE),
('D108', 'room', 'Gebäude D · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 34.58, 9.06, 5, TRUE, TRUE),
('C106', 'room', 'Gebäude C · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 57.7, 26.85, 5, TRUE, TRUE),
('C107', 'room', 'Gebäude C · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 51.29, 26.85, 5, TRUE, TRUE),
('A108', 'room', 'Gebäude A · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 33.16, 62.42, 5, TRUE, TRUE),
('A109', 'room', 'Gebäude A · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 26.52, 62.42, 5, TRUE, TRUE),
('A110', 'room', 'Gebäude A · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 20.43, 62.42, 5, TRUE, TRUE),
('A111', 'room', 'Gebäude A · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 13.06, 62.33, 5, TRUE, TRUE),
('A112', 'room', 'Gebäude A · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 4.85, 62.33, 5, TRUE, TRUE),
('A113', 'room', 'Gebäude A · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 4.85, 66.21, 5, TRUE, TRUE),
('E205', 'room', 'Gebäude E · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 48.12, 94.1, 5, TRUE, TRUE),
('E209', 'room', 'Gebäude E · 1. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 5.', 43.01, 78.41, 5, TRUE, TRUE),
('D201', 'room', 'Gebäude D · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 30.26, 21.09, 6, TRUE, TRUE),
('D202', 'room', 'Gebäude D · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 34.14, 19.51, 6, TRUE, TRUE),
('D203', 'room', 'Gebäude D · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 34.41, 15.57, 6, TRUE, TRUE),
('D206', 'room', 'Gebäude D · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 34.41, 9.2, 6, TRUE, TRUE),
('C201', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 39.22, 40.28, 6, TRUE, TRUE),
('C202', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 45.72, 40.28, 6, TRUE, TRUE),
('C203', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 51.67, 40.28, 6, TRUE, TRUE),
('C204', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 57.75, 40.28, 6, TRUE, TRUE),
('C206', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 57.75, 35.45, 6, TRUE, TRUE),
('C210', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 57.52, 26.9, 6, TRUE, TRUE),
('C211', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 51.42, 26.9, 6, TRUE, TRUE),
('C212', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 45.46, 26.9, 6, TRUE, TRUE),
('C213', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 39.03, 26.9, 6, TRUE, TRUE),
('C216', 'room', 'Gebäude C · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 38.98, 35.45, 6, TRUE, TRUE),
('A202', 'room', 'Gebäude A · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 33.23, 66.93, 6, TRUE, TRUE),
('A207', 'room', 'Gebäude A · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 26.6, 62.2, 6, TRUE, TRUE),
('A208', 'room', 'Gebäude A · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 20.25, 62.2, 6, TRUE, TRUE),
('A209', 'room', 'Gebäude A · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 13.3, 62.2, 6, TRUE, TRUE),
('A210', 'room', 'Gebäude A · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 5.1, 62.2, 6, TRUE, TRUE),
('A211', 'room', 'Gebäude A · 2. Obergeschoss', 'Klassenraum nach dem offiziellen RNG-Übersichtsplan, PDF-Seite 6.', 5.08, 66.1, 6, TRUE, TRUE)
on conflict do nothing;
