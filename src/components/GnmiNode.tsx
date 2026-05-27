import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  HEADER_SOURCE_HANDLE,
  HEADER_TARGET_HANDLE,
  fieldHandleId,
  type GnmiNode as GnmiNodeType,
} from '../data/gnmi070';

const kindLabels: Record<string, string> = {
  service: 'service',
  rpc: 'rpc',
  message: 'message',
  enum: 'enum',
  oneof: 'oneof',
  embedded: 'embedded',
  extension: 'gnmi_ext',
  deprecated: 'deprecated',
};

export function GnmiNode({ data, selected }: NodeProps<GnmiNodeType>) {
  return (
    <article className={`gnmi-node gnmi-node--${data.kind} ${selected ? 'is-selected' : ''}`}>
      <header className="gnmi-node__header">
        {data.visibleHandles?.headerTarget ? (
          <Handle
            id={HEADER_TARGET_HANDLE}
            className="gnmi-node__handle gnmi-node__handle--header"
            type="target"
            position={Position.Left}
            isConnectable={false}
          />
        ) : null}
        {data.visibleHandles?.headerSource ? (
          <Handle
            id={HEADER_SOURCE_HANDLE}
            className="gnmi-node__handle gnmi-node__handle--header"
            type="source"
            position={Position.Right}
            isConnectable={false}
          />
        ) : null}
        <div>
          {data.packageName ? <p className="gnmi-node__package">{data.packageName}</p> : null}
          <h2>{data.title}</h2>
          {data.subtitle ? <p>{data.subtitle}</p> : null}
        </div>
        <span>{kindLabels[data.kind]}</span>
      </header>

      {data.fields?.length ? (
        <ul className="gnmi-node__fields">
          {data.fields.map((field) => (
            <li key={field.signature} className={field.deprecated ? 'is-deprecated' : undefined}>
              {data.visibleHandles?.fieldTargets?.includes(field.handleId ?? fieldHandleId(field.signature)) ? (
                <Handle
                  id={field.handleId ?? fieldHandleId(field.signature)}
                  className="gnmi-node__handle gnmi-node__handle--field gnmi-node__handle--target"
                  type="target"
                  position={Position.Left}
                  isConnectable={false}
                />
              ) : null}
              {data.visibleHandles?.fieldSources?.includes(field.handleId ?? fieldHandleId(field.signature)) ? (
                <Handle
                  id={field.handleId ?? fieldHandleId(field.signature)}
                  className="gnmi-node__handle gnmi-node__handle--field gnmi-node__handle--source"
                  type="source"
                  position={Position.Right}
                  isConnectable={false}
                />
              ) : null}
              {field.signature}
            </li>
          ))}
        </ul>
      ) : null}

      {data.values?.length ? (
        <ul className="gnmi-node__values">
          {data.values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : null}

      {data.note ? <p className="gnmi-node__note">{data.note}</p> : null}

      <footer className="gnmi-node__links nodrag">
        {data.docsUrl ? (
          <a href={data.docsUrl} target="_blank" rel="noreferrer">
            docs
          </a>
        ) : null}
        {data.codeUrl ? (
          <a href={data.codeUrl} target="_blank" rel="noreferrer" title={data.codePath}>
            {data.codePath ?? 'proto'}
          </a>
        ) : null}
      </footer>
    </article>
  );
}
