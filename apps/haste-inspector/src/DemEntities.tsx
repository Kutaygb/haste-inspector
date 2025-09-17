import { useVirtualizer } from "@tanstack/react-virtual";
import {
  isEHandleValid,
  type EntityFieldLi,
  type EntityLi,
  eHandleToIndex,
} from "haste-wasm";
import { useAtom } from "jotai";
import { BracesIcon, CogIcon, FileTextIcon, Link2Icon, Link2OffIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import DemFilterBar, { type UpdateEventHandler } from "./DemFilterBar";
import {
  demParserAtom,
  demSelectedEntityIndexAtom,
  demTickAtom,
  demViewAtom,
} from "./atoms";
import { Button } from "./lib/Button";
import * as DropdownMenu from "./lib/DropdownMenu";
import { ScrollArea } from "./lib/ScrollArea";
import { Tooltip } from "./lib/Tooltip";
import { cn } from "./lib/style";

const LI_HEIGHT = 26;

const DEFAULT_SHOW_ENTITY_INDEX = false;

const DEFAULT_SHOW_FIELD_ENCODED_TYPE = true;
const DEFAULT_SHOW_FIELD_DECODED_TYPE = false;
const DEFAULT_SHOW_FIELD_PATH = false;

const EXPORT_BUTTON_CLASS =
  "h-auto gap-1 rounded-sm border border-divider/60 bg-transparent px-2 py-1 text-xs font-medium text-fg-subtle transition-colors hover:border-divider hover:bg-neutral-500/10 hover:text-fg";

function triggerDownload(filename: string, content: string, mimeType: string) {
  if (typeof window === "undefined") {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type ExportEntityField = {
  path: string;
  pathSegments: number[];
  encodedAs: string;
  decodedAs: string;
  value: string;
};

type ExportEntity = {
  index: number;
  name: string;
  fields: ExportEntityField[];
};

type EntityListPreferencesProps = {
  showEntityIndex: boolean;
  setShowEntityIndex: (value: boolean) => void;
};

// NOTE: keep this in sync with EntityFieldListPreferences
function EntityListPreferences(props: EntityListPreferencesProps) {
  const { showEntityIndex, setShowEntityIndex } = props;

  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <span className="inline-flex">
          <Tooltip content="display preferences">
            <Button size="small" className={cn(open && "bg-neutral-500/30")}>
              <CogIcon className={cn("size-4", !open && "stroke-fg-subtle")} />
            </Button>
          </Tooltip>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          // NOTE: following classes are stolen from tooltip
          className="bg-white dark:bg-black rounded z-10"
        >
          <DropdownMenu.CheckboxItem
            checked={showEntityIndex}
            onCheckedChange={setShowEntityIndex}
          >
            entity index
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function EntityList() {
  const [demParser] = useAtom(demParserAtom);
  const [demView] = useAtom(demViewAtom);
  const [demTick] = useAtom(demTickAtom);
  const entityList = useMemo(() => {
    demTick; // trick eslint

    let entityList: EntityLi[] | undefined;
    if (demView === "entities") {
      entityList = demParser?.listEntities();
    } else if (demView === "baselineEntities") {
      entityList = demParser?.listBaselineEntities();
    }

    return entityList;
  }, [demParser, demView, demTick]);

  const [, startTransition] = useTransition();
  const [filteredEntityList, setFinalEntityList] = useState(entityList);
  const handleFilterUpdate: UpdateEventHandler<EntityLi> = useCallback(
    (entries, searchCmpFn) => {
      startTransition(() => {
        if (searchCmpFn) {
          setFinalEntityList(
            entries?.filter((entry) => searchCmpFn(entry.name)),
          );
        } else {
          setFinalEntityList(entries);
        }
      });
    },
    [],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredEntityList?.length ?? 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => LI_HEIGHT,
  });

  const [demSelectedEntityIndex, setDemSelectedEntityIndex] = useAtom(
    demSelectedEntityIndexAtom,
  );
  const handleClick = useCallback(
    (ev: React.MouseEvent<HTMLLIElement>) => {
      const entityIndex = +ev.currentTarget.dataset.entidx!;
      if (entityIndex >= 0 && entityIndex <= Number.MAX_SAFE_INTEGER) {
        setDemSelectedEntityIndex((prevEntityIndex) =>
          prevEntityIndex === entityIndex ? undefined : entityIndex,
        );
      }
    },
    [setDemSelectedEntityIndex],
  );

  const [showEntityIndex, setShowEntityIndex] = useState(
    DEFAULT_SHOW_ENTITY_INDEX,
  );

  const isBaselineView = demView === "baselineEntities";
  const baseFileName = useMemo(() => {
    const prefix = isBaselineView ? "baseline-entities" : "entities";
    const tickSegment = Number.isFinite(demTick) ? `tick-${demTick}` : undefined;
    return tickSegment ? `${prefix}-${tickSegment}` : prefix;
  }, [demTick, isBaselineView]);
  const hasEntities = (entityList?.length ?? 0) > 0;

  const collectEntitiesForExport = useCallback((): ExportEntity[] => {
    if (!demParser) {
      return [];
    }

    const listEntities = isBaselineView
      ? demParser.listBaselineEntities.bind(demParser)
      : demParser.listEntities.bind(demParser);
    const listEntityFields = isBaselineView
      ? demParser.listBaselineEntityFields.bind(demParser)
      : demParser.listEntityFields.bind(demParser);

    const entities = listEntities();
    if (!entities?.length) {
      return [];
    }

    return entities.map((entity) => ({
      index: entity.index,
      name: entity.name,
      fields: (listEntityFields(entity.index) ?? []).map((field) => ({
        path: field.namedPath.join("."),
        pathSegments: Array.from(field.path),
        encodedAs: field.encodedAs,
        decodedAs: field.decodedAs,
        value: field.value,
      })),
    }));
  }, [demParser, isBaselineView]);

  const handleExportAllRaw = useCallback(() => {
    const entitiesForExport = collectEntitiesForExport();
    if (!entitiesForExport.length) {
      return;
    }

    const lines: string[] = [];
    lines.push(`view: ${isBaselineView ? "baselineEntities" : "entities"}`);
    lines.push(`tick: ${demTick}`);
    lines.push("");

    entitiesForExport.forEach((entity) => {
      lines.push(`entity ${entity.index}: ${entity.name}`);
      if (!entity.fields.length) {
        lines.push("  (no fields)");
      } else {
        entity.fields.forEach((field) => {
          lines.push(`  ${field.path}: ${field.value}`);
        });
      }
      lines.push("");
    });

    const fileBase = `${baseFileName}-fields`;
    triggerDownload(
      `${fileBase}.txt`,
      `${lines.join("\n").trimEnd()}\n`,
      "text/plain;charset=utf-8",
    );
  }, [baseFileName, collectEntitiesForExport, demTick, isBaselineView]);

  const handleExportAllJson = useCallback(() => {
    const entitiesForExport = collectEntitiesForExport();
    if (!entitiesForExport.length) {
      return;
    }

    const payload = {
      tick: demTick,
      view: isBaselineView ? "baselineEntities" : "entities",
      entities: entitiesForExport,
    };

    const fileBase = `${baseFileName}-fields`;
    triggerDownload(
      `${fileBase}.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
      "application/json",
    );
  }, [baseFileName, collectEntitiesForExport, demTick, isBaselineView]);

  return (
    <div className="w-full h-full flex flex-col">
      <DemFilterBar
        entries={entityList}
        onUpdate={handleFilterUpdate}
        placehoder="filter entities…"
        endAdornment={
          <>
            <Tooltip content="download all entities as plain text">
              <Button
                size="small"
                disabled={!hasEntities}
                onClick={handleExportAllRaw}
                className={EXPORT_BUTTON_CLASS}
              >
                <FileTextIcon className="h-3.5 w-3.5" /></Button>
            </Tooltip>
            <Tooltip content="download all entities as JSON">
              <Button
                size="small"
                disabled={!hasEntities}
                onClick={handleExportAllJson}
                className={EXPORT_BUTTON_CLASS}
              >
                <BracesIcon className="h-3.5 w-3.5" /></Button>
            </Tooltip>
            <div className="w-px h-4 bg-divider" />
            <EntityListPreferences
              showEntityIndex={showEntityIndex}
              setShowEntityIndex={setShowEntityIndex}
            />
          </>
        }
        className="border-b border-divider"
      />
      {!entityList?.length && (
        <p className="m-2 text-fg-subtle">no entities, try moving the slider</p>
      )}
      <ScrollArea className="w-full grow" viewportRef={viewportRef}>
        <ul
          className="w-full h-full relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entityItem = filteredEntityList![virtualItem.index];
            const entitySelected = demSelectedEntityIndex === entityItem?.index;
            return (
              <li
                key={virtualItem.key}
                className={cn(
                  "haste-li haste-li__virtual haste-li__selectable flex items-center",
                  entitySelected && "haste-li__selected",
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                data-entidx={entityItem?.index}
                onClick={handleClick}
              >
                {showEntityIndex && (
                  <span
                    className="opacity-40 text-end mr-2"
                    style={{ minWidth: "4ch" }}
                  >
                    {entityItem.index}
                  </span>
                )}
                <span className="text-ellipsis overflow-hidden whitespace-nowrap">
                  {entityItem.name}
                </span>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}

type EntityFieldListPreferencesProps = {
  showFieldPath: boolean;
  setShowFieldPath: (value: boolean) => void;
  showFieldEncodedType: boolean;
  setShowFieldEncodedType: (value: boolean) => void;
  showFieldDecodedType: boolean;
  setShowFieldDecodedType: (value: boolean) => void;
};

// NOTE: keep this in sync with EntityListPreferences
function EntityFieldListPreferences(props: EntityFieldListPreferencesProps) {
  const {
    showFieldPath,
    setShowFieldPath,
    showFieldEncodedType,
    setShowFieldEncodedType,
    showFieldDecodedType,
    setShowFieldDecodedType,
  } = props;

  const [open, setOpen] = useState(false);

  const active = open;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <span className="inline-flex">
          <Tooltip content="display preferences">
            <Button size="small" className={cn(active && "bg-neutral-500/30")}>
              <CogIcon
                className={cn("size-4", !active && "stroke-fg-subtle")}
              />
            </Button>
          </Tooltip>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          // NOTE: following classes are stolen from tooltip
          className="bg-white dark:bg-black rounded z-10"
        >
          <DropdownMenu.CheckboxItem
            checked={showFieldPath}
            onCheckedChange={setShowFieldPath}
          >
            field path
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            checked={showFieldEncodedType}
            onCheckedChange={setShowFieldEncodedType}
          >
            encoded type
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            checked={showFieldDecodedType}
            onCheckedChange={setShowFieldDecodedType}
          >
            decoded type
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function EntityFieldList() {
  const [demParser] = useAtom(demParserAtom);
  const [demView] = useAtom(demViewAtom);
  const [demSelectedEntityIndex] = useAtom(demSelectedEntityIndexAtom);
  const [demTick] = useAtom(demTickAtom);

  const { entityFieldList, joinedPathMaxLen } = useMemo(() => {
    demTick; // trick eslint

    if (demSelectedEntityIndex === undefined) {
      return {};
    }

    let tmpEntityFieldList: EntityFieldLi[] | undefined;
    if (demView === "entities") {
      tmpEntityFieldList = demParser?.listEntityFields(demSelectedEntityIndex);
    } else if (demView === "baselineEntities") {
      tmpEntityFieldList = demParser?.listBaselineEntityFields(
        demSelectedEntityIndex,
      );
    }

    let joinedPathMaxLen = 0;

    const entityFieldList = tmpEntityFieldList?.map((entityField) => {
      const joinedPath = Array.from(entityField.path)
        .map((part) => part.toString().padStart(4, " "))
        .join("");
      joinedPathMaxLen = Math.max(joinedPathMaxLen, joinedPath.length);
      return {
        inner: entityField,
        joinedPath,
        joinedNamedPath: entityField.namedPath.join("."),
      };
    });

    entityFieldList?.sort((a, b) => {
      // compare path arrays element by element
      for (
        let i = 0;
        i < Math.min(a.inner.path.length, b.inner.path.length);
        i++
      ) {
        if (a.inner.path[i] !== b.inner.path[i]) {
          return a.inner.path[i] - b.inner.path[i];
        }
      }
      // if the paths are equal up to the minimum length, the shorter path
      // comes first
      return a.inner.path.length - b.inner.path.length;
    });

    return { entityFieldList, joinedPathMaxLen };
  }, [demParser, demView, demSelectedEntityIndex, demTick]);

  type WrappedEntityFieldLi = NonNullable<typeof entityFieldList>[0];

  const [, startTransition] = useTransition();
  const [filteredEntityFieldList, setFinalEntityFieldList] =
    useState(entityFieldList);
  const handleFilterUpdate: UpdateEventHandler<WrappedEntityFieldLi> =
    useCallback((entries, searchCmpFn) => {
      startTransition(() => {
        if (searchCmpFn) {
          setFinalEntityFieldList(
            entries?.filter((entry) => searchCmpFn(entry.joinedNamedPath)),
          );
        } else {
          setFinalEntityFieldList(entries);
        }
      });
    }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredEntityFieldList?.length ?? 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => LI_HEIGHT,
  });

  const [showFieldEncodedType, setShowFieldEncodedType] = useState(
    DEFAULT_SHOW_FIELD_ENCODED_TYPE,
  );
  const [showFieldDecodedType, setShowFieldDecodedType] = useState(
    DEFAULT_SHOW_FIELD_DECODED_TYPE,
  );
  const [showFieldPath, setShowFieldPath] = useState(DEFAULT_SHOW_FIELD_PATH);

  const [selectedFieldPaths, setSelectedFieldPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const lastSelectedIndexRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    lastSelectedIndexRef.current = undefined;
    setSelectedFieldPaths((prev) => (prev.size ? new Set<string>() : prev));
  }, [demSelectedEntityIndex, demView]);

  useEffect(() => {
    if (!filteredEntityFieldList?.length) {
      lastSelectedIndexRef.current = undefined;
      setSelectedFieldPaths((prev) => (prev.size ? new Set<string>() : prev));
      return;
    }

    const availablePaths = new Set(
      filteredEntityFieldList.map((item) => item.joinedNamedPath),
    );

    setSelectedFieldPaths((prev) => {
      if (!prev.size) {
        return prev;
      }

      let changed = false;
      const next = new Set<string>();
      prev.forEach((path) => {
        if (availablePaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [filteredEntityFieldList]);

  const selectedFields = useMemo(() => {
    if (!filteredEntityFieldList || !selectedFieldPaths.size) {
      return [];
    }

    return filteredEntityFieldList.filter((item) =>
      selectedFieldPaths.has(item.joinedNamedPath),
    );
  }, [filteredEntityFieldList, selectedFieldPaths]);
  const selectedFieldCount = selectedFields.length;

  const visibleFields = filteredEntityFieldList ?? [];
  const exportableFields = selectedFieldCount > 0 ? selectedFields : visibleFields;
  const hasExportableFields = exportableFields.length > 0;
  const counterValue = selectedFieldCount > 0 ? selectedFieldCount : visibleFields.length;

  const selectedEntity = useMemo(() => {
    demTick; // trick eslint

    if (demSelectedEntityIndex === undefined) {
      return undefined;
    }

    let entities: EntityLi[] | undefined;
    if (demView === "entities") {
      entities = demParser?.listEntities();
    } else if (demView === "baselineEntities") {
      entities = demParser?.listBaselineEntities();
    }

    return entities?.find((entity) => entity.index === demSelectedEntityIndex);
  }, [demParser, demView, demSelectedEntityIndex, demTick]);
  const selectedEntityName = selectedEntity?.name;

  const baseFileName = useMemo(() => {
    const prefix =
      demView === "baselineEntities" ? "baseline-entity" : "entity";

    if (demSelectedEntityIndex === undefined) {
      return `${prefix}`;
    }

    const sanitizedName = selectedEntityName
      ? selectedEntityName
          .replace(/[^a-z0-9-_]+/gi, "_")
          .replace(/_{2,}/g, "_")
          .replace(/^_+|_+$/g, "")
      : undefined;

    const indexSegment = `${demSelectedEntityIndex}`;
    return sanitizedName
      ? `${prefix}-${indexSegment}-${sanitizedName}`
      : `${prefix}-${indexSegment}`;
  }, [demSelectedEntityIndex, demView, selectedEntityName]);

  const [, setDemSelectedEntityIndex] = useAtom(demSelectedEntityIndexAtom);

  const updateSelection = useCallback(
    (event: React.MouseEvent, itemIndex: number, path: string) => {
      if (!filteredEntityFieldList?.length) {
        return;
      }

      setSelectedFieldPaths((prev) => {
        if (event.shiftKey && lastSelectedIndexRef.current !== undefined) {
          const start = Math.min(lastSelectedIndexRef.current, itemIndex);
          const end = Math.max(lastSelectedIndexRef.current, itemIndex);
          const next = new Set<string>();
          for (let i = start; i <= end; i++) {
            const listItem = filteredEntityFieldList[i];
            if (listItem) {
              next.add(listItem.joinedNamedPath);
            }
          }
          return next;
        }

        if (event.metaKey || event.ctrlKey) {
          const next = new Set(prev);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return next;
        }

        if (prev.size === 1 && prev.has(path)) {
          return prev;
        }

        return new Set<string>([path]);
      });

      lastSelectedIndexRef.current = itemIndex;
    },
    [filteredEntityFieldList],
  );

  const handleFieldClick = useCallback(
    (
      event: React.MouseEvent<HTMLLIElement>,
      itemIndex: number,
      linkedEntityIndex: number | null,
      path: string,
    ) => {
      updateSelection(event, itemIndex, path);

      if (
        linkedEntityIndex !== null &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey
      ) {
        setDemSelectedEntityIndex((prevEntityIndex) =>
          prevEntityIndex === linkedEntityIndex ? undefined : linkedEntityIndex,
        );
      }
    },
    [setDemSelectedEntityIndex, updateSelection],
  );

  const handleExportRaw = useCallback(() => {
    if (!exportableFields.length) {
      return;
    }

    const lines = exportableFields.map(
      (field) => `${field.joinedNamedPath}: ${field.inner.value}`,
    );

    const fileBase = `${baseFileName}-fields`;
    triggerDownload(
      `${fileBase}.txt`,
      `${lines.join("\n")}\n`,
      "text/plain;charset=utf-8",
    );
  }, [baseFileName, exportableFields]);

  const handleExportJson = useCallback(() => {
    if (!exportableFields.length) {
      return;
    }

    const payload = exportableFields.map((field) => ({
      path: field.joinedNamedPath,
      encodedAs: field.inner.encodedAs,
      decodedAs: field.inner.decodedAs,
      value: field.inner.value,
    }));

    const fileBase = `${baseFileName}-fields`;
    triggerDownload(
      `${fileBase}.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
      "application/json",
    );
  }, [baseFileName, exportableFields]);

  return (
    <div className="w-full h-full flex flex-col">
      <DemFilterBar
        entries={entityFieldList}
        onUpdate={handleFilterUpdate}
        updateDelay={10}
        placehoder="filter entity fields…"
        endAdornment={
          <>
            <Tooltip content="download visible fields as plain text">
              <Button
                size="small"
                disabled={!hasExportableFields}
                onClick={handleExportRaw}
                className={EXPORT_BUTTON_CLASS}
              >
                <FileTextIcon className="h-3.5 w-3.5" />
                raw
              </Button>
            </Tooltip>
            <Tooltip content="download visible fields as JSON">
              <Button
                size="small"
                disabled={!hasExportableFields}
                onClick={handleExportJson}
                className={EXPORT_BUTTON_CLASS}
              >
                <BracesIcon className="h-3.5 w-3.5" />
                json
              </Button>
            </Tooltip>
            {counterValue > 0 && (
              <span className="text-xs text-fg-subtle">{counterValue}</span>
            )}
            <div className="w-px h-4 bg-divider" />
            <EntityFieldListPreferences
              showFieldEncodedType={showFieldEncodedType}
              setShowFieldEncodedType={setShowFieldEncodedType}
              showFieldDecodedType={showFieldDecodedType}
              setShowFieldDecodedType={setShowFieldDecodedType}
              showFieldPath={showFieldPath}
              setShowFieldPath={setShowFieldPath}
            />
          </>
        }
        className="border-b border-divider"
      />
      {demSelectedEntityIndex === undefined && (
        <p className="m-2 text-fg-subtle">
          to view entity fields, select an entity from the list of entities
        </p>
      )}
      {demSelectedEntityIndex !== undefined && !entityFieldList?.length && (
        <p className="m-2 text-fg-subtle">
          the previously selected entity does not exist at the current tick
        </p>
      )}
      <ScrollArea className="w-full grow" viewportRef={viewportRef}>
        <ul
          className="w-full h-full relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entityFieldItem = filteredEntityFieldList![virtualItem.index];

            const handle =
              entityFieldItem.inner.encodedAs.startsWith("CHandle");
            const handleValid =
              handle && isEHandleValid(+entityFieldItem.inner.value);
            const linkedEntIdx = handleValid
              ? eHandleToIndex(+entityFieldItem.inner.value)
              : null;
            const isSelected = selectedFieldPaths.has(
              entityFieldItem.joinedNamedPath,
            );

            return (
              <li
                key={virtualItem.key}
                className={cn(
                  "haste-li haste-li__virtual haste-li__selectable flex items-center",
                  isSelected && "haste-li__selected",
                )}
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                aria-selected={isSelected}
                onClick={(event) =>
                  handleFieldClick(
                    event,
                    virtualItem.index,
                    linkedEntIdx,
                    entityFieldItem.joinedNamedPath,
                  )
                }
              >
                <span className="whitespace-nowrap gap-x-[1ch] flex items-center">
                  {showFieldPath && (
                    <span
                      className="opacity-40 whitespace-pre mr-2"
                      style={{ width: `${joinedPathMaxLen}ch` }}
                    >
                      {entityFieldItem.joinedPath}
                    </span>
                  )}
                  <span>{entityFieldItem.joinedNamedPath}</span>
                  <span className="opacity-40 -ml-2">:</span>
                  {(showFieldEncodedType || showFieldDecodedType) && (
                    <>
                      {showFieldEncodedType && (
                        <span className="opacity-40">
                          {entityFieldItem.inner.encodedAs || "_"}
                        </span>
                      )}
                      {showFieldEncodedType && showFieldDecodedType && (
                        <span className="opacity-40">{"->"}</span>
                      )}
                      {showFieldDecodedType && (
                        <span className="opacity-40">
                          {entityFieldItem.inner.decodedAs}
                        </span>
                      )}
                    </>
                  )}
                  <span className="text-fg">{entityFieldItem.inner.value}</span>
                  {handle &&
                    (handleValid ? (
                      <Tooltip content="click to navigate to the linked entity">
                        <Link2Icon className="size-4" />
                      </Tooltip>
                    ) : (
                      <Tooltip content="this handle is invalid">
                        <Link2OffIcon className="size-4" />
                      </Tooltip>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}

export default function DemEntities() {
  return (
    <div className="grow h-0">
      <PanelGroup direction="horizontal">
        <Panel minSize={24} defaultSize={24}>
          <EntityList />
        </Panel>
        <PanelResizeHandle className="haste-panel-resize-handle" />
        <Panel minSize={24}>
          <EntityFieldList />
        </Panel>
      </PanelGroup>
    </div>
  );
}
