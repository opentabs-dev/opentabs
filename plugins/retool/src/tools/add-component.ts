import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const addComponent = defineTool({
  name: 'add_component',
  displayName: 'Add Component',
  description:
    'Add a UI widget component to a Retool app. Handles Transit JSON manipulation internally — you only need to specify the component type, properties, and position. Common types: TextWidget (markdown text), ButtonWidget2 (button), TextInputWidget (input field), TableWidget2 (data table), SelectWidget (dropdown), NumberInputWidget (number input), CheckboxWidget (checkbox), ContainerWidget (container/frame).',
  summary: 'Add a UI widget to an app',
  icon: 'plus-square',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID'),
    component_id: z.string().describe('Unique component ID (e.g., "text1", "submitButton", "usersTable")'),
    component_type: z
      .string()
      .describe(
        'Widget subtype: TextWidget, ButtonWidget2, TextInputWidget, NumberInputWidget, SelectWidget, TableWidget2, CheckboxWidget, ContainerWidget, DateTimeWidget, ImageWidget, JSONExplorerWidget, StatisticWidget',
      ),
    properties: z
      .record(z.string(), z.unknown())
      .describe(
        'Template properties for the widget. TextWidget: { value, format }. ButtonWidget2: { text, styleVariant }. TextInputWidget: { label, placeholder }. TableWidget2: { data }. SelectWidget: { values, labels }.',
      ),
    position: z
      .object({
        row: z.number().describe('Grid row (0-based)'),
        col: z.number().describe('Grid column (0-11, 12 columns total)'),
        width: z.number().describe('Width in grid columns (1-12)'),
        height: z.number().describe('Height in grid rows'),
      })
      .describe('Grid position for the component'),
  }),
  output: z.object({
    save_id: z.number().describe('New save ID after adding the component'),
    success: z.boolean(),
  }),
  handle: async params => {
    const data = await api<{ page: { id: number; multiplayerSessionId: string | null; data: { appState: string } } }>(
      `/api/pages/uuids/${params.page_uuid}`,
    );
    const currentSaveId = data.page.id;
    const multiplayerSessionId = data.page.multiplayerSessionId;
    const appState = data.page.data.appState;
    if (!appState) throw ToolError.notFound('App state not found');

    const parsed = JSON.parse(appState) as unknown[];
    const modified = injectComponent(
      parsed,
      params.component_id,
      params.component_type,
      params.properties,
      params.position,
    );
    const newAppState = JSON.stringify(modified);

    const saveResp = await api<{ save: { id: number } }>(`/api/pages/uuids/${params.page_uuid}/save`, {
      method: 'POST',
      body: {
        appState: newAppState,
        branchName: null,
        changesRecordV2: { changes: [], numUntrackedActionsTriggered: 1, isCopilotMode: false },
        saveValidationInfo: { multiplayerSessionId, pageSaveId: currentSaveId },
        isCopilotGenerated: false,
        subflowsDiff: null,
        saveAppTesting: false,
      },
    });

    return { save_id: saveResp.save?.id ?? 0, success: true };
  },
});

function injectComponent(
  parsed: unknown[],
  id: string,
  componentType: string,
  properties: Record<string, unknown>,
  position: { row: number; col: number; width: number; height: number },
): unknown[] {
  const templateMap = parsed[1] as unknown[];
  const vIdx = templateMap.indexOf('v');
  const appMap = templateMap[vIdx + 1] as unknown[];

  let pluginsIdx = -1;
  for (let i = 1; i < appMap.length; i += 2) {
    if (appMap[i] === 'plugins') {
      pluginsIdx = i + 1;
      break;
    }
  }

  if (pluginsIdx === -1) throw ToolError.internal('Could not find plugins map in app state');

  const plugins = appMap[pluginsIdx] as unknown[];
  const entries = plugins[1] as unknown[];
  const now = Date.now();

  const templateEntries: unknown[] = [];
  for (const [key, val] of Object.entries(properties)) {
    templateEntries.push(key, val);
  }
  if (!('events' in properties)) {
    templateEntries.push('events', ['~#iM', []]);
  }

  const component: unknown[] = [
    '~#iR',
    [
      '^ ',
      'n',
      'pluginTemplate',
      'v',
      [
        '^ ',
        'id',
        id,
        'uuid',
        null,
        '_comment',
        null,
        'type',
        'widget',
        'subtype',
        componentType,
        'namespace',
        null,
        'resourceName',
        null,
        'resourceDisplayName',
        null,
        'template',
        ['~#iM', templateEntries],
        'style',
        ['~#iM', []],
        'position2',
        [
          '~#iR',
          [
            '^ ',
            'n',
            'position2',
            'v',
            [
              '^ ',
              'type',
              'grid',
              'container',
              '',
              'rowGroup',
              'body',
              'subcontainer',
              '',
              'row',
              position.row,
              'col',
              position.col,
              'height',
              position.height,
              'width',
              position.width,
              'tabNum',
              0,
              'stackPosition',
              null,
            ],
          ],
        ],
        'mobilePosition2',
        null,
        'mobileAppPosition',
        null,
        'tabIndex',
        null,
        'container',
        '',
        'createdAt',
        `~m${now}`,
        'updatedAt',
        `~m${now}`,
        'folder',
        '',
        'presetName',
        null,
        'screen',
        null,
        'boxId',
        null,
        'subBoxIds',
        null,
      ],
    ],
  ];

  entries.push(id, component);
  return parsed;
}
