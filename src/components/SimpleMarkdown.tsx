import { View, Text } from '@tarojs/components'
import {
  parseSimpleMarkdown,
  type MdBlock,
  type MdInline,
} from '../utils/simple-markdown'
import './SimpleMarkdown.scss'

function InlineNodes({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'text') {
          return <Text key={i}>{n.text}</Text>
        }
        if (n.type === 'strong') {
          return (
            <Text key={i} className='md-strong'>
              <InlineNodes nodes={n.children} />
            </Text>
          )
        }
        return (
          <Text key={i} className='md-em'>
            <InlineNodes nodes={n.children} />
          </Text>
        )
      })}
    </>
  )
}

function HardBreakLines({ lines }: { lines: MdInline[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i} className='md-line'>
          <InlineNodes nodes={line} />
          {i < lines.length - 1 ? '\n' : ''}
        </Text>
      ))}
    </>
  )
}

function BlockView({ block }: { block: MdBlock }) {
  if (block.type === 'hr') {
    return <View className='md-hr' />
  }
  if (block.type === 'h') {
    return (
      <Text className={`md-h md-h--${block.level}`}>
        <InlineNodes nodes={block.children} />
      </Text>
    )
  }
  if (block.type === 'p') {
    return (
      <Text className='md-p'>
        <HardBreakLines lines={block.lines} />
      </Text>
    )
  }
  if (block.type === 'quote') {
    return (
      <View className='md-quote'>
        <Text className='md-quote__text'>
          <HardBreakLines lines={block.lines} />
        </Text>
      </View>
    )
  }
  if (block.type === 'task') {
    return (
      <View className='md-list md-list--task'>
        {block.items.map((item, i) => (
          <View key={i} className='md-li md-li--task'>
            <View
              className={`md-check${item.checked ? ' md-check--on' : ''}`}
            >
              {item.checked ? (
                <Text className='md-check__mark'>✓</Text>
              ) : null}
            </View>
            <Text
              className={`md-li__body${
                item.checked ? ' md-li__body--done' : ''
              }`}
            >
              <InlineNodes nodes={item.children} />
            </Text>
          </View>
        ))}
      </View>
    )
  }
  if (block.type === 'ul') {
    return (
      <View className='md-list md-list--ul'>
        {block.items.map((item, i) => (
          <View key={i} className='md-li'>
            <Text className='md-li__mark'>•</Text>
            <Text className='md-li__body'>
              <InlineNodes nodes={item.children} />
            </Text>
          </View>
        ))}
      </View>
    )
  }
  return (
    <View className='md-list md-list--ol'>
      {block.items.map((item, i) => (
        <View key={i} className='md-li'>
          <Text className='md-li__mark'>{i + 1}.</Text>
          <Text className='md-li__body'>
            <InlineNodes nodes={item.children} />
          </Text>
        </View>
      ))}
    </View>
  )
}

export function SimpleMarkdown({
  source,
  className,
}: {
  source: string
  className?: string
}) {
  const blocks = parseSimpleMarkdown(source)
  if (blocks.length === 0) return null
  return (
    <View className={['md', className].filter(Boolean).join(' ')}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </View>
  )
}
