{{- define "elementa.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "elementa.fullname" -}}
{{- default (printf "%s-%s" .Release.Name (include "elementa.name" .)) .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "elementa.selectorLabels" -}}
app.kubernetes.io/name: {{ include "elementa.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "elementa.labels" -}}
{{ include "elementa.selectorLabels" . }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "elementa.serviceAccount" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "elementa.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
{{- define "elementa.image" -}}
{{- if .Values.image.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .Values.image.digest) -}}
{{- fail "image.digest must be a sha256 digest" -}}
{{- end -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (required "Set image.tag or image.digest to a published image" .Values.image.tag) -}}
{{- end -}}
{{- end -}}
