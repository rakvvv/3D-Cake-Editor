package com.cake.editor.controller;

import com.cake.editor.model.ExtruderVariantMetadata;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@RestController
@RequestMapping(path = "/api/extruder-variants", produces = MediaType.APPLICATION_JSON_VALUE)
public class ExtruderVariantsController {

    private final ObjectMapper objectMapper;
    private final Resource variantsResource = new ClassPathResource("extruder-variants.json");

    public ExtruderVariantsController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public List<ExtruderVariantMetadata> variants() throws IOException {
        try (InputStream inputStream = variantsResource.getInputStream()) {
            return objectMapper.readValue(inputStream, new TypeReference<>() {
            });
        }
    }
}
