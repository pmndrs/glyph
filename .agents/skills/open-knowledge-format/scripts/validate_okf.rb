#!/usr/bin/env ruby

require 'date'
require 'pathname'
require 'time'
require 'yaml'
require_relative 'package_digest'

root = Pathname(ARGV.shift || '.').expand_path
abort "bundle root does not exist: #{root}" unless root.directory?
workspace_root = nil
until ARGV.empty?
  option = ARGV.shift
  abort "unknown option: #{option}" unless option == '--workspace-root'
  workspace_root = Pathname(ARGV.shift || abort('--workspace-root requires a path')).expand_path
end

conformance = []
profile = []
warnings = []
package_concepts = Hash.new { |entries, name| entries[name] = [] }

actor = %r{\A(?:[^/:\s]+/[^\s]+|human:[^\s]+|process:[^\s]+)\z}
date = /\A\d{4}-\d{2}-\d{2}\z/

parse_date = lambda do |value|
  Date.iso8601(value.to_s)
  value.to_s.match?(date)
rescue Date::Error
  false
end

parse_datetime = lambda do |value|
  next false unless value.to_s.match?(/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\z/)
  Time.iso8601(value.to_s)
  true
rescue ArgumentError
  false
end

parse_frontmatter = lambda do |path, text, errors|
  match = text.match(/\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n/m)
  unless match
    errors << "#{path}: missing parseable frontmatter block"
    next [nil, nil]
  end

  begin
    data = YAML.safe_load(match[1], permitted_classes: [Date, Time], aliases: false) || {}
    unless data.is_a?(Hash)
      errors << "#{path}: frontmatter must be a mapping"
      next [nil, nil]
    end
    [data, text[match.end(0)..]]
  rescue StandardError => error
    errors << "#{path}: invalid YAML (#{error.message})"
    [nil, nil]
  end
end

validate_window = lambda do |path, value, label|
  unless value.is_a?(Hash) && parse_date.call(value['from']) && parse_date.call(value['to'])
    profile << "#{path}: #{label} must contain ISO dates from and to"
    next
  end
  profile << "#{path}: #{label}.from must not be after .to" if Date.iso8601(value['from'].to_s) > Date.iso8601(value['to'].to_s)
end

validate_resource = lambda do |path, value, label|
  next if value.to_s.empty? || value.match?(%r{\A(?:https?://|[a-z][a-z0-9+.-]*:)}i)
  next if value.match?(/\s/)
  local = value.split('#', 2).first
  next if local.nil? || local.empty?
  resolved = Pathname(local.start_with?('/') ? root.join(local.delete_prefix('/')) : path.dirname.join(local)).cleanpath
  profile << "#{path}: missing local #{label} #{value}" unless resolved.exist?
end

concepts = root.glob('**/*.md').reject { |path| %w[index.md log.md].include?(path.basename.to_s) }
concepts.each do |path|
  begin
    text = path.read(encoding: 'UTF-8')
  rescue StandardError => error
    conformance << "#{path}: not readable UTF-8 (#{error.message})"
    next
  end

  data, body = parse_frontmatter.call(path, text, conformance)
  next unless data

  package_concepts[data['workspace_package']] << [path, data] if data['workspace_package'].is_a?(String)

  conformance << "#{path}: missing non-empty type" unless data['type'].is_a?(String) && !data['type'].strip.empty?
  profile << "#{path}: legacy timestamp field" if data.key?('timestamp')
  profile << "#{path}: legacy # Citations section" if body&.match?(/^# Citations[ \t]*$/)

  generated = data['generated']
  unless generated.is_a?(Hash)
    profile << "#{path}: missing generated mapping"
  else
    profile << "#{path}: generated.by is not a valid actor" unless generated['by'].is_a?(String) && generated['by'].match?(actor)
    profile << "#{path}: generated.at is not an ISO 8601 datetime" unless parse_datetime.call(generated['at'])
  end

  source_ids = []
  sources = data['sources']
  if sources && !sources.is_a?(Array)
    profile << "#{path}: sources must be a list"
  elsif sources
    sources.each_with_index do |source, index|
      label = "sources[#{index}]"
      unless source.is_a?(Hash)
        profile << "#{path}: #{label} must be a mapping"
        next
      end
      profile << "#{path}: #{label}.resource is required" if source['resource'].to_s.strip.empty?
      validate_resource.call(path, source['resource'], "#{label}.resource") if source['resource'].is_a?(String)
      if source.key?('id')
        profile << "#{path}: #{label}.id must be a non-empty string" unless source['id'].is_a?(String) && !source['id'].empty?
        source_ids << source['id'] if source['id'].is_a?(String)
      end
      profile << "#{path}: #{label}.usage_count must be a non-negative integer" if source.key?('usage_count') && (!source['usage_count'].is_a?(Integer) || source['usage_count'].negative?)
      profile << "#{path}: #{label}.last_modified must be an ISO date" if source.key?('last_modified') && !parse_date.call(source['last_modified'])
      validate_window.call(path, source['usage_window'], "#{label}.usage_window") if source.key?('usage_window')
    end
    profile << "#{path}: duplicate sources[].id values" unless source_ids.compact.uniq.length == source_ids.compact.length
  end
  validate_window.call(path, data['usage_window'], 'usage_window') if data.key?('usage_window')

  body&.scan(/\[\^([^\]]+)\]/)&.flatten&.uniq&.each do |footnote|
    warnings << "#{path}: footnote #{footnote} has no matching sources[].id" unless source_ids.include?(footnote)
  end

  if data.key?('verified')
    events = data['verified'].is_a?(Array) ? data['verified'] : [data['verified']]
    events.each_with_index do |event, index|
      unless event.is_a?(Hash)
        profile << "#{path}: verified[#{index}] must be a mapping"
        next
      end
      profile << "#{path}: verified[#{index}].by is not a valid actor" unless event['by'].is_a?(String) && event['by'].match?(actor)
      profile << "#{path}: verified[#{index}].at is not an ISO 8601 datetime" unless parse_datetime.call(event['at'])
    end
  end

  profile << "#{path}: status must be draft, stable, or deprecated" if data.key?('status') && !%w[draft stable deprecated].include?(data['status'])
  profile << "#{path}: stale_after must be an ISO date" if data.key?('stale_after') && !parse_date.call(data['stale_after'])
  validate_resource.call(path, data['resource'], 'resource') if data['resource'].is_a?(String)

  if data['type'] == 'Attested Computation'
    profile << "#{path}: Attested Computation requires runtime" unless data['runtime'].is_a?(String) && !data['runtime'].empty?
    if data.key?('parameters')
      if !data['parameters'].is_a?(Array)
        profile << "#{path}: parameters must be a list"
      else
        data['parameters'].each_with_index do |parameter, index|
          valid = parameter.is_a?(Hash) && parameter['name'].is_a?(String) && parameter['type'].is_a?(String) && [true, false].include?(parameter['required'])
          profile << "#{path}: parameters[#{index}] requires string name/type and boolean required" unless valid
        end
      end
    end
    profile << "#{path}: computation must be a non-empty path" if data.key?('computation') && (!data['computation'].is_a?(String) || data['computation'].empty?)
    validate_resource.call(path, data['computation'], 'computation') if data['computation'].is_a?(String)
    %w[executor attester].each do |field|
      next unless data.key?(field)
      value = data[field]
      profile << "#{path}: #{field} must contain resource" unless value.is_a?(Hash) && !value['resource'].to_s.empty?
      validate_resource.call(path, value['resource'], "#{field}.resource") if value.is_a?(Hash) && value['resource'].is_a?(String)
      profile << "#{path}: executor.receipt must be a list" if field == 'executor' && value.is_a?(Hash) && value.key?('receipt') && !value['receipt'].is_a?(Array)
    end
  end

  warnings << "#{path}: missing title" unless data['title'].is_a?(String) && !data['title'].empty?
  warnings << "#{path}: missing description" unless data['description'].is_a?(String) && !data['description'].empty?
end

if workspace_root
  abort "workspace root does not exist: #{workspace_root}" unless workspace_root.directory?
  begin
    workspace_packages = OkfPackageDigest.workspace_packages(workspace_root).to_h
  rescue StandardError => error
    abort error.message
  end

  workspace_packages.each do |name, package_root|
    entries = package_concepts.fetch(name, [])
    if entries.empty?
      profile << "workspace package #{name}: missing OKF Workspace Package concept"
      next
    end
    if entries.length > 1
      profile << "workspace package #{name}: duplicate concepts #{entries.map(&:first).join(', ')}"
      next
    end

    path, data = entries.first
    profile << "#{path}: workspace package concept must use type Workspace Package" unless data['type'] == 'Workspace Package'
    profile << "#{path}: workspace package concept must use documentation_type reference" unless data['documentation_type'] == 'reference'
    expected_resource = package_root.relative_path_from(path.dirname).to_s
    profile << "#{path}: resource must identify #{expected_resource}" unless data['resource'] == expected_resource
    expected_digest = OkfPackageDigest.digest(package_root)
    profile << "#{path}: stale source_digest; expected #{expected_digest}" unless data['source_digest'] == expected_digest
  end

  (package_concepts.keys - workspace_packages.keys).each do |name|
    package_concepts[name].each do |path, _data|
      profile << "#{path}: workspace_package #{name} does not exist in apps/* or packages/*"
    end
  end
end

root_index = root.join('index.md')
if root_index.exist?
  text = root_index.read(encoding: 'UTF-8')
  if text.start_with?('---')
    data, = parse_frontmatter.call(root_index, text, conformance)
    if data
      conformance << "#{root_index}: root index frontmatter may contain only okf_version" unless data.keys == ['okf_version']
      profile << "#{root_index}: expected okf_version 0.2" unless data['okf_version'].to_s == '0.2'
    end
  else
    warnings << "#{root_index}: root index does not declare okf_version 0.2"
  end
  conformance << "#{root_index}: index requires a heading" unless text.match?(/^\#{1,6} .+$/)
end

root.glob('**/index.md').reject { |path| path == root_index }.each do |path|
  text = path.read(encoding: 'UTF-8')
  conformance << "#{path}: nested index must not have frontmatter" if text.match?(/\A---[ \t]*\r?\n/)
  conformance << "#{path}: index requires a heading" unless text.match?(/^\#{1,6} .+$/)
end

root.glob('**/log.md').each do |path|
  text = path.read(encoding: 'UTF-8')
  h1s = text.scan(/^# (?!#).+$/)
  conformance << "#{path}: log requires exactly one H1 title" unless h1s.length == 1 && text.match?(/\A# (?!\d{4}-\d{2}-\d{2}$).+$/)
  dates = text.scan(/^## (\d{4}-\d{2}-\d{2})$/).flatten
  conformance << "#{path}: log requires H2 ISO date sections" if dates.empty?
  conformance << "#{path}: log dates must be newest-first" unless dates == dates.sort.reverse
  conformance << "#{path}: date sections must use H2" if text.match?(/^# \d{4}-\d{2}-\d{2}$/)
end

root.glob('**/*.md').each do |path|
  path.read(encoding: 'UTF-8').scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |target|
    next if target.match?(/\A(?:https?:|mailto:|#)/)
    local = target.split('#', 2).first
    next if local.nil? || local.empty?
    resolved = Pathname(local.start_with?('/') ? root.join(local.delete_prefix('/')) : path.dirname.join(local)).cleanpath
    profile << "#{path}: missing local link #{target}" unless resolved.exist?
  end
end

puts "OKF v0.2 validation for #{root}"
puts "Conformance errors: #{conformance.length}"
conformance.each { |error| puts "  - #{error}" }
puts "Producer-profile errors: #{profile.length}"
profile.each { |error| puts "  - #{error}" }
puts "Warnings: #{warnings.length}"
warnings.each { |warning| puts "  - #{warning}" }
exit 1 unless conformance.empty? && profile.empty?
