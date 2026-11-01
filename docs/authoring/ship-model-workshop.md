# Ship model workshop

Open **Fleet**, select a **project template**, then **Hull**. The **Model workshop** below the hull properties edits the ship's appearance and attachment points. These changes are saved in the project and included in Verify, Export and Install scenario.

## Choose where models are read from: Model source

The top of the workshop has three separate lines:

- **Project target** — the engine the project is built for. Original ships and name checks come from this engine.
- **Model source** — the installation the preview reads meshes and textures from. Choose any registered installation: EE 2024, EE 2026, or a second copy of either. Each entry shows its name, engine version and folder, so two installations of one version can be told apart.
- **Install scenario goes to** — the installation chosen in the toolbar.

Changing the **Model source** changes only the preview and the list of models offered. It does not change the target or the install destination, does not assign or replace any model on a ship, and does not mark the project as changed. The choice is remembered for this project on this computer; it is not saved in the project file, which never contains a folder path.

Forge does not guess: if several installations match the project's engine, nothing is chosen until you choose; if the chosen installation is no longer there, the workshop says so and keeps it selected until you pick another. Models are read straight from the installation's `resources` folder and `packs/*.pack` archives — nothing is extracted or copied, and a file that has been removed is reported missing.

Under the preview, **Resource origin** lists each mesh and texture with the installation, the archive (or file) it comes from, and its size — or what is wrong: *missing*, *format not supported*, *archive unreadable*. When something cannot be read there is no stand-in ship: the preview stays empty and says why.

If you pick a model from a source that the project's engine does not define (for example a 2026-only model in a 2024 project), it is **previewed only** and not assigned. **Customise model** copies it into the project; whether it can load in the game you install to is then checked (below).

### Can this model load where I install it?

Verify, the Install scenario check and Install look at the destination installation. They block the install, naming the file, when a copied model's mesh or texture, or a stock model a template uses, does not exist there. They warn when a file with the same name has different contents in the model source and in the destination (the ship will look like the destination's file). A 2026 normal map in a 2024 project is refused until removed. Nothing is deleted or replaced for you. **Export** has no destination to check, so its `INSTALL.txt` lists the required files under *REQUIREMENTS NOT VERIFIED*: make sure the target game has them in `resources` or `packs`.

## Start from an installed model

1. Register and **rescan** your EmptyEpsilon installation. Older cached scans do not contain the full model definitions.
2. Copy a ship into the project if you are viewing an original ship.
3. Under **3D model**, choose a model from the model source. This assigns its existing name to the template when the project's engine defines it; it does not change the installation.
4. Press **Customise model**. Forge makes a separately named project model and assigns it to this template. The original stays unchanged.
5. If other templates inherit or use the model, their names appear above the workshop. **Make separate copy** assigns an independent model to the selected template. Inheriting variants naturally inherit their parent's model until explicitly overridden.

## Import an external model

Press **Import OBJ + textures…**, and select **one OBJ and its PNG/JPG textures together**. The importer triangulates faces, supplies vertex normals and writes positive vertex/UV/normal indices for the two EE loaders. Use one material with a shared UV atlas: MTL material assignments are not imported. GLB/glTF require conversion to OBJ first (for example in your modelling software).

Limits: 8 MiB per source/converted OBJ file, 20 MiB of model resources; at most 32 resources per model. A project must fit the 30 MiB save limit. Textures are embedded in the project document, so copying/importing `project.json` carries them. Export writes the actual binary files to `resources/forge-models/<unique-id>/`. It does not write base64 text as an image. Only these namespaced resources are installed; stock meshes are not redistributed.

The first imported image becomes the main texture. Expand **Mesh & texture resources** to choose the main, specular or illumination texture from the imported paths. The model starts at scale 1 with an estimated radius enclosing its mesh in the game plane; adjust both for the intended ship size.

## Parameters and coordinates

- **Model scale** multiplies the mesh and model attachment coordinates. It is independent of the collision radius. An empty scale uses EE's default, 1.
- **Radius** is in game units, independent of scale. The amber circle shows this radius. An empty radius uses EE's default, 1.
- **Rectangular collision box** supplies full width/length in game units and overrides the circular physics collider. The coral rectangle shows it.
- **Render offset** moves the mesh before scaling. Beam and missile tube origins include this offset; engine origins do not. This distinction follows EE's ModelData/ModelInfo behaviour.
- **Engine trails** contain X/Y/Z origin, RGB colour and size. Colour components normally range from 0 to 1, not 0 to 255. Old values above 1 are preserved and marked; Forge never silently rescales them. Size and origin are multiplied by model scale.
- **Beam/tube origins** are ordered attachment points. Configure weapon range, arcs, damage and tube properties separately under Weapons. A model's origins alone do not create weapons.
- **Normal maps** are supported by the 2026 engine, not the 2024 engine. An export targeting 2024 refuses `setNormalMap`; clear that field to make a model portable to both. This applies to every project model, including unused copies.

The preview uses EE coordinates, with Z up, EE's OBJ Y/Z conversion and its mesh orientation. X is red, Y green, Z blue. Select a point in the preview or its numbered button, then change its numeric coordinates. Engine cones show origin, colour and size, not a reproduction of EE's particle animation. Markers are selectable; they are not drag handles.

Drag to orbit, use the wheel to zoom, or choose Top/Front/Side. **Fit view** resets framing. Changing scale keeps the camera fixed so the effect remains visible. The preview reads the model source's resources, or the imported bytes in the project. Missing files are reported rather than replaced by a generic ship.

## Use the ship in EmptyEpsilon

1. Put a ship object on the map and select your **project template**.
2. Save and Verify.
3. Use **Install scenario**, or export and follow the bundle's `INSTALL.txt` including the resources folder and launch-time template registration.
4. **Restart EmptyEpsilon completely.** Models and ship templates are created at launch, before a scenario runs. Changing scenarios alone does not reload them.
5. For a player ship, start from a player-ship template such as Atlantis, preserving its energy storage and other player-specific settings. Merely changing a CPU hull's type is not equivalent to copying a complete player template.

This feature is included in the Windows x64 installer 0.9.2. Run the new installer to update a previously installed application; rebuilding the source alone does not update it.
