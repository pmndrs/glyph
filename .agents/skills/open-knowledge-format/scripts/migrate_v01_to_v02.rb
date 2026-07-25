#!/usr/bin/env ruby

require 'date'
require 'json'
require 'pathname'
require 'time'
require 'yaml'

root = Pathname(ARGV.fetch(0)).expand_path
actor = ARGV.fetch(1)
generated_at = ARGV.fetch(2, Time.now.utc.iso8601)
actor_pattern = %r{\A(?:[^/:\s]+/[^\s]+|human:[^\s]+|process:[^\s]+)\z}

abort "bundle root does not exist: #{root}" unless root.directory?
abort 'actor must use producer/version, human:<id>, or process:<id>' unless actor.match?(actor_pattern)
begin
  raise ArgumentError unless generated_at.match?(/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\z/)
  Time.iso8601(generated_at)
rescue ArgumentError
  abort 'generated_at must be an ISO 8601 datetime'
end

def yaml_string(value)
  JSON.generate(value)
end

def parse_frontmatter(path, text)
  match = text.match(/\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n/m)
  abort "missing frontmatter: #{path}" unless match
  begin
    data = YAML.safe_load(match[1], permitted_classes: [Date, Time], aliases: false) || {}
  rescue StandardError => error
    abort "invalid frontmatter in #{path}: #{error.message}"
  end
  abort "frontmatter must be a mapping: #{path}" unless data.is_a?(Hash)
  [match, data]
end

def sources_from(citations)
  links = []
  markdown_link = /\[([^\]]+)\]\(((?:[^()\s]+|\([^()]*\))+|<[^>]+>)\)/
  residual = citations.gsub(markdown_link) do
    title = Regexp.last_match(1).strip
    resource = Regexp.last_match(2).delete_prefix('<').delete_suffix('>')
    links << [title, resource]
    ''
  end
  residual.scan(%r{https?://[^\s<>)]+}).each { |resource| links << [resource, resource] }

  links.uniq.each_with_index.map do |(title, resource), index|
    { 'id' => "citation-#{index + 1}", 'resource' => resource, 'title' => title }
  end
end

concepts = root.glob('**/*.md').reject { |path| %w[index.md log.md].include?(path.basename.to_s) }
migrated = 0
concepts.each do |path|
  text = path.read(encoding: 'UTF-8')
  match, data = parse_frontmatter(path, text)
  frontmatter = match[1]
  body = text[match.end(0)..]
  citation_match = body.match(/(?:\A|\r?\n)# Citations[ \t]*\r?\n+(.*)\z/m)
  has_legacy_metadata = data.key?('timestamp') || citation_match

  next if data.key?('generated') && !has_legacy_metadata
  abort "mixed v0.1 and v0.2 generation metadata: #{path}" if data.key?('generated')
  abort "cannot merge an existing sources field with legacy citations: #{path}" if data.key?('sources') && citation_match

  sources = citation_match ? sources_from(citation_match[1]) : []
  abort "legacy citation section contains no extractable resources: #{path}" if citation_match && sources.empty? && !citation_match[1].strip.empty?
  body = body[0...citation_match.begin(0)].rstrip + "\n" if citation_match

  frontmatter = frontmatter.lines.reject { |line| line.match?(/\Atimestamp:[ \t]*/) }.join.rstrip
  unless sources.empty?
    frontmatter += "\nsources:\n"
    sources.each do |source|
      frontmatter += "  - id: #{yaml_string(source.fetch('id'))}\n"
      frontmatter += "    resource: #{yaml_string(source.fetch('resource'))}\n"
      frontmatter += "    title: #{yaml_string(source.fetch('title'))}\n"
    end
  end
  frontmatter += "\ngenerated:\n  by: #{yaml_string(actor)}\n  at: #{yaml_string(generated_at)}"

  path.write("---\n#{frontmatter}\n---\n\n#{body.lstrip}")
  migrated += 1
end

root_index = root.join('index.md')
if root_index.exist?
  text = root_index.read(encoding: 'UTF-8')
  if text.start_with?('---')
    match, data = parse_frontmatter(root_index, text)
    abort "root index frontmatter may contain only okf_version: #{root_index}" unless data.keys == ['okf_version']
    root_index.write(text[0...match.begin(0)] + "---\nokf_version: \"0.2\"\n---\n" + text[match.end(0)..])
  else
    root_index.write("---\nokf_version: \"0.2\"\n---\n\n#{text}")
  end
end

root.glob('**/log.md').each do |path|
  text = path.read(encoding: 'UTF-8')
  text = "# Knowledge Bundle Update Log\n\n#{text}" if text.match?(/\A# \d{4}-\d{2}-\d{2}[ \t]*$/)
  text = text.gsub(/^# (\d{4}-\d{2}-\d{2})[ \t]*$/, '## \1')
  path.write(text)
end

puts "Migrated #{migrated} concepts in #{root} to the OKF v0.2 producer profile."
